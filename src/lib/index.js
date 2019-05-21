const lighthouse = require("lighthouse");
const chromeLauncher = require("chrome-launcher");
const fs = require("fs-extra");
const path = require("path");
const chalk = require("chalk");
const log = console.log;

const getLightHouseConfig = () => {
  return fs.readJSONSync(path.resolve(__dirname, "../config/lighthouse.json"));
};

const getAuditBudgets = () => {
  return fs.readJSONSync(path.resolve(__dirname, "../config/audit.json"));
};

function launchChromeAndRunLighthouse(url, opts, config = null) {
  return chromeLauncher
    .launch({ chromeFlags: opts.chromeFlags })
    .then(chrome => {
      opts.port = chrome.port;
      opts.output = "json";

      const { isCustom, ...lightHouseConfig } = getLightHouseConfig();

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

    const { isCustom, ...lightHouseConfig } = getLightHouseConfig();
    const auditConfig = getAuditBudgets();
    const data = await launchChromeAndRunLighthouse(url, opts);

    // Performance
    const { audits: speedAudits } = auditConfig;
    const { audits: auditResults } = data;
    speedAudits.forEach(audit => {
      if (
        auditResults.hasOwnProperty(audit.id) &&
        auditResults[audit.id].hasOwnProperty("numericValue")
      ) {

        const overBudget =
          auditResults[audit.id].numericValue - audit.timeBudget;
        audit.actualSpeed = auditResults[audit.id].numericValue;
        audit.overBudgetBy = overBudget > 0 ? overBudget : undefined;
      }
    });

    const successfulSpeedAudits = speedAudits.filter(
      ({ overBudgetBy }) => !overBudgetBy
    );

    // Bundle limits and requests
    const budgets = data["audits"]["performance-budget"];

    const { details: { items = [] } = {} } = budgets;
    const successfulBudgets = items.filter(
      ({ sizeOverBudget, countOverBudget }) => {
        return !sizeOverBudget && !countOverBudget;
      }
    );

    const isValid =
      successfulBudgets.length === items.length &&
      successfulSpeedAudits.length === speedAudits.length;

    if (!isValid) {
      const failedSpeedAudits = speedAudits.filter(
        ({ overBudgetBy }) => overBudgetBy
      );

      const failedRequestCountAudits = failedBudgets.filter(
        audit => audit.countOverBudget !== undefined
      );

      const failedSizeAudits = failedAudits.filter(
        audit => audit.sizeOverBudget !== undefined
      );

      if (failedSpeedAudits.length) {
        log(chalk.red("----- Failed page speed budget audits ------"));
        failedSpeedAudits.forEach(
          ({ id, timeBudget, overBudgetBy, actualSpeed } = {}) => {
            log(
              `${chalk.green(id)}: Expected ${chalk.green(
                timeBudget
              )} ms but got ${chalk.red(actualSpeed)}`
            );
          }
        );
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

      if (failedSizeAudits.length) {
        log(chalk.red("----- Failed resource size budget audits ------"));
        failedSizeAudits.forEach(
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
