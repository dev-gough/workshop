import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { getConfig } from './config';
import { laptopImageModel, parseImageProgress } from './parlor-models';

export interface ImageProgress {
  step: number;
  total: number;
  secondsPerStep: number;
}

const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8'];

function sshTarget(): string {
  return getConfig().ollama?.sshHost ?? 'devy-l';
}

export class LaptopImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LaptopImageError';
  }
}

/** Draw on the laptop. The prompt is stdin, never a shell argument. The drawer name is an allowlisted id. */
export function generateLaptopImage(
  prompt: string,
  drawer: NonNullable<ReturnType<typeof laptopImageModel>>,
  onProgress?: (progress: ImageProgress) => void,
): Promise<Buffer> {
  if (laptopImageModel(drawer) !== drawer) {
    return Promise.reject(new LaptopImageError('That drawer isn’t on the laptop.'));
  }
  const remote = `/home/devon/compute/out/parlor-${crypto.randomBytes(8).toString('hex')}.png`;
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', [...SSH_OPTS, sshTarget(), '/home/devon/compute/parlor-image.sh', remote, drawer], { stdio: ['pipe', 'pipe', 'pipe'] });
    const err: Buffer[] = [];
    let carry = '';
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      fail(new LaptopImageError('The laptop took too long to draw.'));
    }, 12 * 60_000);
    const take = (text: string) => {
      carry += text;
      const parts = carry.split(/\r|\n/);
      carry = parts.pop() ?? '';
      for (const part of parts) {
        const progress = parseImageProgress(part);
        if (progress) onProgress?.(progress);
      }
    };
    child.stderr.on('data', (chunk: Buffer) => {
      err.push(chunk);
      take(chunk.toString('utf8'));
    });
    child.on('error', fail);
    child.on('close', (code) => {
      if (settled) return;
      take('\n');
      if (code !== 0) {
        const line = Buffer.concat(err).toString('utf8').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').split(/\r|\n/).map((row) => row.trim()).filter((row) => row && !row.startsWith('|')).at(-1);
        fail(new LaptopImageError(line || 'The laptop couldn’t draw that.'));
        return;
      }
      settled = true;
      clearTimeout(timer);
      const cat = spawn('ssh', [...SSH_OPTS, sshTarget(), 'cat', remote], { stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];
      const catErr: Buffer[] = [];
      const catTimer = setTimeout(() => {
        cat.kill('SIGKILL');
        reject(new LaptopImageError('The laptop finished without a picture.'));
      }, 60_000);
      cat.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      cat.stderr.on('data', (chunk: Buffer) => catErr.push(chunk));
      cat.on('close', (catCode) => {
        clearTimeout(catTimer);
        spawn('ssh', [...SSH_OPTS, sshTarget(), 'rm', '-f', remote], { stdio: 'ignore' }).unref();
        const bytes = Buffer.concat(chunks);
        if (catCode !== 0 || bytes.length < 16) {
          reject(new LaptopImageError(Buffer.concat(catErr).toString('utf8').trim() || 'The laptop finished without a picture.'));
          return;
        }
        resolve(bytes);
      });
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}
