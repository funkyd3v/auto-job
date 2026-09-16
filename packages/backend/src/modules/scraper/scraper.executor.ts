import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SourceType, ScrapeResult, ScrapeJobInput } from './scraper.types.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SCRIPTS_DIR = resolve(__dirname, '../../../scripts');

export class ScraperExecutionError extends Error {
  constructor(
    message: string,
    public readonly sourceType: SourceType,
    public readonly exitCode: number | null,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = 'ScraperExecutionError';
  }
}

export class ScraperExecutor {
  /**
   * Execute the Python scraper via subprocess.
   *
   * @param input - Scrape configuration
   * @param timeoutMs - Maximum execution time (default: 5 minutes)
   * @returns ScrapeResult with jobs and metadata
   */
  async execute(input: ScrapeJobInput, timeoutMs: number = 300_000): Promise<ScrapeResult> {
    const scriptPath = resolve(SCRIPTS_DIR, 'scrape.py');
    const configJson = JSON.stringify({
      keywords: input.keywords,
      location: input.location,
    });

    return new Promise<ScrapeResult>((resolve, reject) => {
      const proc = spawn('python3', [
        scriptPath,
        '--source', input.source_type,
        '--config', configJson,
        '--max-pages', String(input.max_pages),
      ], {
        cwd: SCRIPTS_DIR,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
        },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        const detail = stderr.trim() ? `: ${stderr.trim().slice(0, 1500)}` : '';
        reject(new ScraperExecutionError(
          `Scraper timed out after ${timeoutMs}ms${detail}`,
          input.source_type,
          null,
          stderr,
        ));
      }, timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timer);

        if (code !== 0) {
          const detail = stderr.trim() ? `: ${stderr.trim().slice(0, 1500)}` : '';
          reject(new ScraperExecutionError(
            `Scraper exited with code ${code}${detail}`,
            input.source_type,
            code,
            stderr,
          ));
          return;
        }

        try {
          const result: ScrapeResult = JSON.parse(stdout);
          resolve(result);
        } catch (err) {
          reject(new ScraperExecutionError(
            `Failed to parse scraper output: ${(err as Error).message}`,
            input.source_type,
            code,
            stdout,
          ));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new ScraperExecutionError(
          `Failed to spawn scraper process: ${err.message}`,
          input.source_type,
          null,
          stderr,
        ));
      });
    });
  }
}
