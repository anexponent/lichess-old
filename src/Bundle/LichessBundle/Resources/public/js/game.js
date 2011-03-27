$.widget("lichess.game", {

    _init: function() {
        var self = this;
        self.pieceMoving = false;
        self.$board = self.element.find("div.lichess_board");
        self.$table = self.element.find("div.lichess_table_wrap");
        self.$chat = $("div.lichess_chat");
        self.initialTitle = document.title;

        if (self.options.game.started) {
            self.indicateTurn();
            self.initSquaresAndPieces();
            self.initChat();
            self.initTable();
            self.initClocks();
            if (self.isMyTurn() && self.options.player.version == 1) self.element.one('lichess.audio_ready', function() {
                $.playSound();
            });
            if (!self.options.game.finished && !self.options.player.spectator) {
                self.blur = 0;
                $(window).blur(function() {
                    self.blur = 1;
                });
            }
            self.unloaded = false;
            $(window).unload(function() {
                self.unloaded = true;
            });
        }

        if (!self.options.opponent.ai && !self.options.player.spectator) {
            // update document title to show playing state
            setTimeout(self.updateTitle = function() {
                document.title = (self.isMyTurn() && ! self.options.game.finished) ? document.title = document.title.indexOf('/\\/') == 0 ? '\\/\\ ' + document.title.replace(/\/\\\/ /, '') : '/\\/ ' + document.title.replace(/\\\/\\ /, '') : document.title;
                setTimeout(self.updateTitle, 400);
            },
            400);
        }

        function syncLoop() {
            if (!self.options.opponent.ai || self.options.player.spectator) {
                if (!self.options.game.finished || ! self.options.player.spectator) {
                    self.sync(syncLoop);
                }
            }
        }
        setTimeout(syncLoop, 1000);
    },
    sync: function(callback) {
        var self = this;
        self.currentSync = $.ajax(self.options.url.sync.replace(/9999999/, self.options.player.version), {
            type: 'POST',
            dataType: 'json',
            timeout: self.options.sync_latency + 5000,
            success: function(data) {
                if (!data) return self.onError();
                if (!self.options.opponent.ai && self.options.game.started && self.options.opponent.active != data.oa) {
                    self.options.opponent.active = data.oa;
                    self.get(self.options.url.opponent, {
                        success: function(html) {
                            self.$table.find('div.lichess_opponent').html(html).find('a').tipsy({
                                fade: true
                            });
                        }
                    });
                }
                if (data.v && data.v != self.options.player.version) {
                    self.options.player.version = data.v;
                    self.applyEvents(data.e);
                }
                if (data.t) {
                    self.options.game.turns = data.t;
                }
                if (data.p) {
                    self.options.game.player = data.p;
                }
                if (data.c) {
                    self.updateClocks(data.c);
                }
            },
            complete: function(xhr, status) {
                if (status != 'success') {
                    self.onError();
                    return;
                }
                $.isFunction(callback) && callback();
            }
        });
    },
    isMyTurn: function() {
        return this.options.possible_moves != null;
    },
    changeTitle: function(text) {
        if (this.options.player.spectator) return;
        document.title = text + " - " + this.initialTitle;
    },
    indicateTurn: function() {
        var self = this;
        if (self.options.game.finished) {
            self.changeTitle(self.translate('Game over'));
        }
        else if (self.isMyTurn()) {
            self.element.addClass("my_turn");
            self.changeTitle(self.translate('Your turn'));
        }
        else {
            self.element.removeClass("my_turn");
            self.changeTitle(self.translate('Waiting for opponent'));
        }

        if (!self.$table.find('>div').hasClass('finished')) {
            self.$table.find("div.lichess_current_player div.lichess_player." + (self.isMyTurn() ? self.options.opponent.color: self.options.player.color)).fadeOut(self.options.animation_delay);
            self.$table.find("div.lichess_current_player div.lichess_player." + (self.isMyTurn() ? self.options.player.color: self.options.opponent.color)).fadeIn(self.options.animation_delay);
        }
    },
    movePiece: function(from, to, callback) {
        var self = this,
        $piece = self.$board.find("div#" + from + " div.lichess_piece");

        // already moved
        if (!$piece.length) {
            $.isFunction(callback || null) && callback();
            return;
        }

        $("div.lcs.moved", self.$board).removeClass("moved");
        var $from = $("div#" + from, self.$board).addClass("moved");
        var $to = $("div#" + to, self.$board).addClass("moved");
        var $killed = $to.find("div.lichess_piece");
        from_offset = $from.offset();
        to_offset = $to.offset();
        isMyPiece = $piece.hasClass(self.options.player.color);
        castling = $killed.length && self.getPieceColor($piece) == self.getPieceColor($killed);

        if (!isMyPiece || this.options.player.spectator) $.playSound();

        if (castling) {
            $.isFunction(callback || null) && callback();
            return;
        }

        $("body").append($piece.css({
            top: from_offset.top,
            left: from_offset.left
        }));
        $piece.animate({
            top: to_offset.top,
            left: to_offset.left
        },
        self.options.animation_delay * (isMyPiece ? 1: 2), function() {
            if ($killed.length) {
                self.killPiece($killed);
            }
            $to.append($piece.css({
                top: 0,
                left: 0
            }));
            $.isFunction(callback || null) && callback();
        });
    },
    killPiece: function($piece) {
        if ($.data($piece, 'draggable')) $piece.draggable("destroy");
        var self = this,
        $deads = self.element.find("div.lichess_cemetery." + self.getPieceColor($piece)),
        $square = $piece.parent();
        $deads.append($("<div>").addClass('lichess_tomb'));
        var $tomb = $("div.lichess_tomb:last", $deads),
        tomb_offset = $tomb.offset();
        $('body').append($piece.css($square.offset()));
        $piece.css("opacity", 0).animate({
            top: tomb_offset.top,
            left: tomb_offset.left,
            opacity: 0.5
        },
        self.options.animation_delay * 3, function() {
            $tomb.append($piece.css({
                position: "relative",
                top: 0,
                left: 0
            }));
        });
    },
    applyEvents: function(events) {
        var self = this;
        var actionEvents = [];

        // if a draw was claimable, remove the zone
        $('div.lichess_claim_draw_zone').remove();

        // Game end must be applied firt
        for (var i in events) {
            if (events[i].type == 'end') {
                self.options.game.finished = true;
                self.element.find("div.ui-draggable").draggable("destroy");
            }
        }

        // apply and overwrite possible_moves and messages
        for (var i in events) {
            if (events[i].type == 'possible_moves') {
                self.options.possible_moves = events[i].possible_moves;
                self.indicateTurn();
            }
            else if (events[i].type == 'message' && self.$chat.length) {
                self.$chat.find('ol.lichess_messages').append(events[i].html)[0].scrollTop = 9999999;
            }
            else {
                actionEvents.push(events[i]);
            }
        }
        events = actionEvents;

        // move first
        for (var i in events) {
            if (events[i].type == 'move') {
                self.$board.find("div.lcs.check").removeClass("check");
                var from = events[i].from,
                to = events[i].to;
                events.splice(i, 1);
                self.movePiece(from, to, function() {
                    self.applyEvents(events);
                });
                return;
            }
        }

        for (var i in events) {
            var event = events[i];
            switch (event.type) {
            case "promotion":
                $("div#" + event.key + " div.lichess_piece").addClass(event.pieceClass).removeClass("pawn");
                break;
            case "castling":
                $("div#" + event.rook[1], self.$board).append($("div#" + event.rook[0] + " div.lichess_piece.rook", self.$board));
                $("div#" + event.king[1], self.$board).append($("div#" + event.king[0] + " div.lichess_piece.king", self.$board));
                break;
            case "enpassant":
                self.killPiece($("div#" + event.killed + " div.lichess_piece", self.$board));
                break;
            case "check":
                $("div#" + event.key, self.$board).addClass("check");
                break;
            case "redirect":
                window.location.href = event.url;
                break;
            case "threefold_repetition":
                self.reloadTable();
                break;
            case "end":
                self.changeTitle(self.translate('Game over'));
                self.element.removeClass("my_turn");
                self.reloadTable();
                break;
            case "reload_table":
                self.reloadTable();
                break;
            default:
                break;
            }
        }
    },
    dropPiece: function($piece, $oldSquare, $newSquare) {
        var self = this,
        squareId = $newSquare.attr('id'),
        moveData = {
            from: $oldSquare.attr("id"),
            to: squareId,
            b: self.blur
        };

        self.blur = 0;
        self.$board.find('div.lcs.selected').removeClass('selected');
        self.options.possible_moves = null;
        self.movePiece($oldSquare.attr("id"), squareId);

        function sendMoveRequest(moveData) {
            self.post(self.options.url.move, {
                success: self.options.opponent.ai ? function() {
                    setTimeout(function() {
                        self.sync();
                    }, self.options.animation_delay);
                }: null,
                data: moveData,
            });
        }

        var color = self.options.player.color;
        // promotion
        if ($piece.hasClass('pawn') && ((color == "white" && squareId[1] == 8) || (color == "black" && squareId[1] == 1))) {
            var $choices = $('<div class="lichess_promotion_choice">').appendTo(self.$board).html('\
                                   <div rel="queen" class="lichess_piece queen ' + color + '"></div>\
                                   <div rel="knight" class="lichess_piece knight ' + color + '"></div>\
                                   <div rel="rook" class="lichess_piece rook ' + color + '"></div>\
                                   <div rel="bishop" class="lichess_piece bishop ' + color + '"></div>').fadeIn(self.options.animation_delay).find('div.lichess_piece').click(function() {
                moveData.options = {
                    promotion: $(this).attr('rel')
                };
                sendMoveRequest(moveData);
                $choices.fadeOut(self.options.animation_delay, function() {
                    $choices.remove();
                });
            }).end();
        }
        else {
            sendMoveRequest(moveData);
        }
    },
    initSquaresAndPieces: function() {
        var self = this;
        if (self.options.player.spectator) {
            return;
        }
        // init squares
        self.$board.find("div.lcs").each(function() {
            var squareId = $(this).attr('id');
            $(this).droppable({
                accept: function(draggable) {
                    return self.isMyTurn() && self.inArray(squareId, self.options.possible_moves[draggable.parent().attr('id')]);
                },
                drop: function(ev, ui) {
                    self.dropPiece(ui.draggable, ui.draggable.parent(), $(this));
                },
                hoverClass: 'droppable-hover'
            });
        });

        // init pieces
        self.$board.find("div.lichess_piece." + self.options.player.color).each(function() {
            $(this).draggable({
                distance: 15,
                containment: self.$board,
                helper: function() {
                    return $('<div>').attr("class", $(this).attr("class")).attr('data-key', $(this).parent().attr('id')).appendTo(self.$board);
                },
                start: function() {
                    self.pieceMoving = true;
                    $(this).addClass("moving");
                },
                stop: function() {
                    self.pieceMoving = false;
                    $(this).removeClass("moving");
                }
            });
        });

        /*
                                   * Code for touch screens like android or iphone
                                   */

        self.$board.find("div.lichess_piece." + self.options.player.color).each(function() {
            $(this).click(function() {
                var $square = $(this).parent();
                if ($square.hasClass('selectable')) return;
                var isSelected = $square.hasClass('selected');
                self.$board.find('div.lcs.selected').removeClass('selected');
                if (isSelected) return;
                $square.addClass('selected');
            });
        });

        self.$board.find("div.lcs").each(function() {
            $(this).hover(function() {
                var $selected = self.$board.find('div.lcs.selected');
                if ($selected.length && self.inArray($(this).attr('id'), self.options.possible_moves[$selected.attr('id')])) {
                    $(this).addClass('selectable');
                }
            },
            function() {
                $(this).removeClass('selectable');
            }).click(function() {
                if (!$(this).hasClass('selectable')) return;
                $(this).removeClass('selectable');
                var $selected = self.$board.find('div.lcs.selected');
                self.dropPiece($selected.find('div.lichess_piece'), $selected, $(this));
            });
        });

        /*
                                   * End of code for touch screens
                                   */
    },
    initChat: function() {
        var self = this;
        if (self.options.player.spectator) {
            return;
        }
        if (self.$chat.length) {
            var $form = self.$chat.find('form');
            self.$chat.find('ol.lichess_messages')[0].scrollTop = 9999999;
            var $input = self.$chat.find('input.lichess_say').one("focus", function() {
                $input.val('').removeClass('lichess_hint');
            });

            // send a message
            $form.submit(function() {
                text = $.trim($input.val());
                if (!text) return false;
                if (text.length > 140) {
                    alert('Max length: 140 chars. ' + text.length + ' chars used.');
                    return false;
                }
                $input.val('');
                self.post(self.options.url.say, {
                    data: {
                        message: text
                    }
                });
                return false;
            });

            self.$chat.find('a.send').click(function() {
                $input.trigger('click');
                $form.submit();
            });

            // toggle the chat
            self.$chat.find('input.toggle_chat').change(function() {
                self.$chat.toggleClass('hidden', ! $(this).attr('checked'));
            }).trigger('change');
        }
    },
    reloadTable: function() {
        var self = this;
        self.get(self.options.url.table, {
            success: function(html) {
                $('body > div.tipsy').remove();
                self.destroyClocks();
                self.$table.html(html);
                self.initTable();
                self.initClocks();
            }
        });
    },
    initTable: function() {
        var self = this;
        self.$table.css('top', (256 - self.$table.height() / 2) + 'px');
        self.$table.find('a, input, label').tipsy({
            fade: true
        });
        self.$table.find('a.lichess_play_again_decline').one('click', function() {
            $(this).parent().remove();
        });
        self.$table.find('a.lichess_rematch').click(function() {
            self.post($(this).attr('href'));
            return false;
        });
    },
    initClocks: function() {
        var self = this;
        if (!self.canRunClock()) return;
        self.$table.find('div.clock').each(function() {
            $(this).clock({
                time: $(this).attr('data-time'),
                buzzer: function() {
                    if (!self.options.game.finished && ! self.options.player.spectator) {
                        self.post(self.options.url.outoftime);
                    }
                }
            });
        });
        self.updateClocks();
    },
    destroyClocks: function() {
        this.$table.find('div.clock_enabled').clock('destroy').remove();
    },
    updateClocks: function(times) {
        var self = this;
        if (!self.canRunClock()) return;
        if (times) {
            for (color in times) {
                self.$table.find('div.clock_' + color).clock('setTime', times[color]);
            }
        }
        self.$table.find('div.clock').clock('stop');
        if (self.options.game.turns > 0) {
            self.$table.find('div.clock_' + self.options.game.player).clock('start');
        }
    },
    canRunClock: function() {
        return this.options.game.clock && this.options.game.started && ! this.options.game.finished;
    },
    getPieceColor: function($piece) {
        return $piece.hasClass('white') ? 'white': 'black';
    },
    translate: function(message) {
        return this.options.i18n[message] || message;
    },
    inArray: function(needle, haystack) {
        for (var i in haystack) {
            if (haystack[i] == needle) {
                return true;
            }
        }
        return false;
    },
    isPlayable: function() {
        return ! this.options.game.finished;
    },
    get: function(url, options) {
        var self = this;
        options = $.extend({
            type: 'GET',
            timeout: 6000,
            cache: false
        }, options || {});
        $.ajax(url, options).complete(function(x, s) {
            self.onXhrComplete(x, s);
        });
    },
    post: function(url, options) {
        var self = this;
        options = $.extend({
            type: 'POST',
            timeout: 6000
        }, options || {});
        $.ajax(url, options).complete(function(x, s) {
            self.onXhrComplete(x, s, 'ok');
        });
    },
    onXhrComplete: function(xhr, status, expectation) {
        if (status != 'success') {
            this.onError();
        }
        if ((expectation || false) && expectation != xhr.responseText) {
            this.onError();
        }
    },
    onError: function() {
        var self = this;
        setTimeout(function() {
            if (!self.unloaded) {
                location.reload();
            }
        }, 1000);
    }
});

$.widget("lichess.clock", {
    _create: function() {
        var self = this;
        this.options.time = parseFloat(this.options.time) * 1000;
        $.extend(this.options, {
            duration: this.options.time,
            state: 'ready'
        });
        this.element.addClass('clock_enabled');
    },
    destroy: function() {
        this.stop();
        $.Widget.prototype.destroy.apply(this);
    },
    start: function() {
        var self = this;
        self.options.state = 'running';
        self.element.addClass('running');
        var end_time = new Date().getTime() + self.options.time;
        self.options.interval = setInterval(function() {
            if (self.options.state == 'running') {
                var current_time = Math.round(end_time - new Date().getTime());
                if (current_time <= 0) {
                    clearInterval(self.options.interval);
                    current_time = 0;
                }

                self.options.time = current_time;
                self._show();

                //If the timer completed, fire the buzzer callback
                current_time == 0 && $.isFunction(self.options.buzzer) && self.options.buzzer(self.element);
            } else {
                clearInterval(self.options.interval);
            }
        },
        1000);
    },

    setTime: function(time) {
        this.options.time = parseFloat(time) * 1000;
        this._show();
    },

    stop: function() {
        clearInterval(this.options.interval);
        this.options.state = 'stop';
        this.element.removeClass('running');
    },

    _show: function() {
        this.element.text(this._formatDate(new Date(this.options.time)));
    },

    _formatDate: function(date) {
        minutes = date.getMinutes();
        if (minutes < 10) minutes = "0" + minutes;
        seconds = date.getSeconds();
        if (seconds < 10) seconds = "0" + seconds;
        return minutes + ':' + seconds;
    }
});
