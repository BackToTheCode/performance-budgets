const lighthouse = require("lighthouse");
const chromeLauncher = require("chrome-launcher");
const fs = require("fs-extra");
const path = require("path");
const chalk = require("chalk");
const log = console.log;

const getLightHouseConfig = configOverride => {
  if(fs.existsSync(path.resolve(__dirname, "../config-override/lighthouse.json"))) {
    return fs.readJSONSync(
      path.resolve(__dirname, "../config-override/lighthouse.json")
    );
  }

  return fs.readJSONSync(path.resolve(__dirname, "../config/lighthouse.json"));
};

function launchChromeAndRunLighthouse(url, opts, config = null) {
  return chromeLauncher
    .launch({ chromeFlags: opts.chromeFlags })
    .then(chrome => {
      opts.port = chrome.port;
      opts.output = "json";

      const { isCustom, ...lightHouseConfig } = getLightHouseConfig(
        opts.configOverride
      );

      if (!isCustom) {
        log(`
-------
Using example configuration for lighthouse. 
You can configure your own lighthouse rules & budgets, read the documentation for more information.
https://github.com/boyney123/performance-budgets
-------
      `);
      }

      return lighthouse(url, opts, lightHouseConfig).then(results => {
        return chrome.kill().then(() => results.lhr);
      });
    });
}

const opts = {
  chromeFlags: [
    "--disable-gpu",
    "--headless",
    "--no-zygote",
    "--no-sandbox",
    "--headless"
  ]
};

const main = async () => {
  try {
    const url = process.argv[2];
    
    if (!url) {
      log(chalk.red("Please provide a url"));
      return Promise.reject("Please provide a valid url");
    }

    log(`Requesting lighthouse data for ${chalk.green(url)}`);

    const data = await launchChromeAndRunLighthouse(url, {
      ...opts,
      configOverride
    });

    // Performance
    const speedResults = data["audits"];
    const bundleResults = data["audits"]["performance-budget"];
    const speedBudgets = data["configSettings"]["speedBudgets"];

    Object.keys(speedResults).forEach(key => {
      const audit = speedResults[key];
      if (audit.hasOwnProperty("numericValue")) {
        const overBudget = audit.numericValue - speedBudgets[audit.id];
        audit.timeBudget = speedBudgets[audit.id];
        audit.overBudgetBy = overBudget > 0 ? overBudget : undefined;
      }
    });

    const successfulSpeedAudits = Object.keys(speedResults).filter(key => {
      return !speedResults[key].overBudgetBy;
    });

    // Bundle limits and requests
    const { details: { items = [] } = {} } = bundleResults;
    const successfulBundleAudits = items.filter(
      ({ sizeOverBudget, countOverBudget }) => {
        return !sizeOverBudget && !countOverBudget;
      }
    );

    const isValid =
      successfulBundleAudits.length === items.length &&
      successfulSpeedAudits.length === Object.keys(speedResults).length;

    if (!isValid) {
      const failedSpeedAudits = Object.keys(speedResults).filter(key => {
        return speedResults[key].overBudgetBy;
      });

      const failedRequestCountAudits = items.filter(
        audit => audit.countOverBudget !== undefined
      );

      const failedBundleAudits = items.filter(
        audit => audit.sizeOverBudget !== undefined
      );

      if (failedSpeedAudits.length) {
        log(chalk.red("----- Failed page speed budget audits ------"));
        failedSpeedAudits.forEach(key => {
          const { id, numericValue, timeBudget } = speedResults[key];
          const actual = Math.round(numericValue);
          log(
            `${chalk.green(id)}: Expected less than ${chalk.green(
              timeBudget
            )} ms but got ${chalk.red(actual)} ms`
          );
        });
      }

      if (failedRequestCountAudits.length) {
        log(chalk.red("----- Failed resource count budget audits ------"));
        failedRequestCountAudits.forEach(
          ({
            label,
            requestCount,
            size,
            sizeOverBudget,
            countOverBudget
          } = {}) => {
            const expectedCount =
              requestCount - countOverBudget.split(" requests")[0];
            log(
              `${chalk.green(label)}: Expected ${chalk.green(
                expectedCount
              )} total number of requests but got ${chalk.red(requestCount)}`
            );
          }
        );
      }

      if (failedBundleAudits.length) {
        log(chalk.red("----- Failed resource size budget audits ------"));
        failedBundleAudits.forEach(
          ({
            label,
            requestCount,
            size,
            sizeOverBudget,
            countOverBudget
          } = {}) => {
            const expectedSize = Math.round((size - sizeOverBudget) / 1024);
            const actual = Math.round(size / 1024);
            const overBy = Math.round(sizeOverBudget / 1024);
            log(
              `${chalk.green(label)}: Expected ${chalk.green(
                expectedSize + "kb"
              )} download size but got ${chalk.red(actual + "kb")}`
            );
          }
        );
      }

      return Promise.reject("Budgets broken");
    }

    log("All budgets passed. ✔");
    return Promise.resolve();
  } catch (error) {
    log(error);
    return Promise.reject("Failed to get lighthouse data");
  }
};

module.exports = main;
