/*
 * config.js — defaults and provider settings.
 */
"use strict";

module.exports = {
  // Default OpenRouter model. ":free" models cost nothing but can be rate-limited;
  // users can override with --model or OPENROUTER_MODEL.
  DEFAULT_OPENROUTER_MODEL: "meta-llama/llama-3.1-8b-instruct:free",

  OPENROUTER_BASE: "https://openrouter.ai/api/v1",
  OPENAI_BASE: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
};
