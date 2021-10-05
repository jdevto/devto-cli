import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import process from 'process';
import Debug from 'debug';
import chalk from 'chalk';
import fs from 'fs-extra';
import {
  defaultArticlesFolder,
  getArticlesFromRemoteData,
  generateArticleFilename,
  saveArticleToFile,
  createNewArticle
} from '../article.js';
import { getAllArticles } from '../api.js';
import { prompt, replaceInFile } from '../util.js';
import {
  getRepositoryFromStringOrEnv,
  parseRepository,
  getShorthandString,
  hasGitInstalled,
  initGitRepository,
  getBranch
} from '../repo.js';
import { createSpinner } from '../spinner.js';
import { Article } from '../models.js';

const debug = Debug('init');
const __dirname = dirname(fileURLToPath(import.meta.url));

interface InitOptions {
  pull: boolean;
  devtoKey: string;
  repo: string;
  branch: string;
  skipGit: boolean;
}

async function createGitHubAction(repoString?: string, repoBranch?: string) {
  let repo = getRepositoryFromStringOrEnv(repoString);
  while (!repo) {
    // eslint-disable-next-line no-await-in-loop
    const string = await prompt(chalk`{green >} Enter your GitHub repository: {grey (username/repository)} `);
    repo = parseRepository(string);
  }

  let branch = await getBranch(repoBranch);
  if (!branch) {
    const string = await prompt(chalk`{green >} Enter the target branch: {grey (main)} `);
    branch = string?.trim() || 'main';
  }

  await fs.copy(path.join(__dirname, '../../template/.github'), '.github');
  await replaceInFile('.github/workflows/publish.yml', 'USERNAME/REPO', getShorthandString(repo));
  await replaceInFile('.github/workflows/publish.yml', 'BRANCH', branch);
}

async function importArticlesFromDevTo(devtoKey: string) {
  const remoteData = await getAllArticles(devtoKey);
  console.info(`Retrieving articles from dev.to…`);

  const remoteArticles = getArticlesFromRemoteData(remoteData);

  console.info(chalk`Found {green ${remoteArticles.length}} article(s) to import.`);

  const processArticle = async (article: Article) => {
    const newArticle = generateArticleFilename(article);
    await saveArticleToFile(newArticle);
  };

  await Promise.all(remoteArticles.map(processArticle));
}

export async function init(options?: Partial<InitOptions>) {
  options = options ?? {};
  options.pull = options.pull ?? false;
  debug('options: %O', options);

  if (options.pull && !options.devtoKey) {
    process.exitCode = -1;
    console.error(
      chalk`{red No dev.to API key provided.}\nUse {bold --token} option or {bold .env} file to provide one.`
    );
    return;
  }

  const spinner = createSpinner(debug);

  try {
    // TODO: check for existing repo/branch
    await createGitHubAction(options.repo, options.branch);

    if (options.pull) {
      spinner.text = 'Retrieving articles from dev.to…';
      spinner.start();
      await importArticlesFromDevTo(options.devtoKey!);
      spinner.stop();
    }

    const articlesFolderExists = await fs.pathExists(defaultArticlesFolder);
    if (!articlesFolderExists) {
      await createNewArticle(path.join(defaultArticlesFolder, 'article.md'));
      console.info(chalk`Created your first article draft in {green posts/article.md}!`);
    }

    if (!options.skipGit) {
      if (await hasGitInstalled()) {
        await initGitRepository();
      } else {
        console.warn(chalk`{yellow Cannot init git repository, git binary not found}`);
      }
    }

    console.info('Init done.');
    console.info(chalk`Take a look at {green .github/workflows/publish.yml} for next steps.`);
  } catch (error) {
    spinner.stop();
    process.exitCode = -1;
    console.error(chalk`{red Error: ${(error as Error).message}}`);
    console.error('Init failed.');
  }
}
