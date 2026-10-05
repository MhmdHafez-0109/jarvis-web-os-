/**
 * JARVIS Web OS — Backend
 * Express server + GLM integration via OpenAI-compatible API
 */
import express from 'express';
import OpenAI from 'openai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app  = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // ضروري ليعمل على Render

/* ══════════════════════════════════════════════════
   إعدادات GLM — تُقرأ من متغيرات البيئة على Render
   ══════════════════════════════════════════════════ */
const CONFIG = {
  GLM_API_KEY : process.env.GLM_API_KEY  || '',
  GLM_BASE_URL: process.env.GLM_BASE_URL || 'https://integrate.api.nvidia.com/v1',
  GLM_MODEL   : process.env.GLM_MODEL    || 'z-ai/glm-4.7',
};

const KEY_READY = CONFIG.GLM_API_KEY.length > 0;

const glm = new OpenAI({
  apiKey : CONFIG.GLM_API_KEY || 'missing',
  baseURL: CONFIG.GLM_BASE_URL,
});