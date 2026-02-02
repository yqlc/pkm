const { createBrowserPage } = require('./utils');

async function waitForLogin(browser, logger, accountData) {

  // 新建页面并打开 Pokemon Center 网站
  const pokemonPage = await createBrowserPage(browser);

  await pokemonPage.goto('https://www.pokemoncenter-online.com/login/', { waitUntil: 'networkidle2', timeout: 60_000 });

  logger.info('已打开 Pokemon Center 网站');

  return pokemonPage;
};

module.exports = {
  __esModule: true,
  waitForLogin,
};
