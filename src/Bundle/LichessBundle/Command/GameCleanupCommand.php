<?php

namespace Bundle\LichessBundle\Command;

use Symfony\Bundle\FrameworkBundle\Command\ContainerAwareCommand as BaseCommand;
use Symfony\Component\Console\Input\InputArgument;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Output\Output;

/**
 * Remove games that don't have really started and are old
 */
class GameCleanupCommand extends BaseCommand
{
    /**
     * @see Command
     */
    protected function configure()
    {
        $this
            ->setDefinition(array(
            ))
            ->addOption('execute', null, InputOption::VALUE_NONE, 'Execute game removal')
            ->setName('lichess:game:cleanup')
        ;
    }

    /**
     * @see Command
     */
    protected function execute(InputInterface $input, OutputInterface $output)
    {
        $repo = $this->getContainer()->get('lichess.repository.game');
        $games = $repo->findCandidatesToCleanup();
        $nb = $games->count();

        $output->writeLn(sprintf('Found %d games to remove', $nb));

        if($input->getOption('execute') && $nb) {
            $max = 2000;
            $output->writeLn(sprintf('Removing %d games...', min($max, $nb)));
            $om = $this->getContainer()->get('doctrine.odm.mongodb.document_manager');
            $it=0;
            foreach($games as $game) {
                if(++$it > $max) break;
                $om->remove($game);
            }
            $om->flush();
        }
    }
}
