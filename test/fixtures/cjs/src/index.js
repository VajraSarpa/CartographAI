const express = require("express");
const routes = require("./routes");
const cfg = require(process.env.CFG);
module.exports = { app: express().use(routes), cfg };
