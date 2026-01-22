#!/usr/bin/env node
/**
 * Rapid API CLI
 *
 * A suite of command-line tools for the Rapid API.
 *
 * Usage:
 *   node apiCli.cjs <command> [options]
 *
 * Commands:
 *   migrate    Run database migrations
 *
 * Environment variables:
 *   NODE_ENV - Set to 'production' for production mode
 *   POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DATABASE
 *     - Required in production mode
 *   DATABASE_URL or POSTGRES_URL - Alternative connection string (dev mode only)
 */

import { program } from 'commander';
import { migrateCommand } from './cli/migrate.js';

const version = '0.0.1';

program
  .name('apiCli')
  .description('Rapid API command-line tools')
  .version(version);

// Register commands
migrateCommand(program);

program.parse();
