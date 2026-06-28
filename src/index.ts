#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openDb } from './db.js';
import { buildServer } from './server.js';

const db = openDb();
const server = buildServer(db);
const transport = new StdioServerTransport();
await server.connect(transport);
