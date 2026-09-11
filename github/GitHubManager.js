/**
 * github/GitHubManager.js
 * Manages interaction with the canonical repository "alilorddomaines-a11y/project".
 * Operates on the existing git repository without creating new repositories.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export class GitHubManager {
  constructor(config = {}) {
    this.repoPath = config.repoPath || process.cwd();
    this.canonicalRepo = 'alilorddomaines-a11y/project';
    this.branch = config.branch || 'main';
  }

  getLatestCommitHash() {
    try {
      return execSync('git rev-parse HEAD', { cwd: this.repoPath, stdio: 'pipe' })
        .toString()
        .trim();
    } catch {
      return 'initial';
    }
  }

  getCommitHistory(limit = 10) {
    try {
      const output = execSync(`git log -n ${limit} --pretty=format:"%h %ad %s" --date=short`, {
        cwd: this.repoPath,
        stdio: 'pipe'
      }).toString();
      return output.split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  writeProjectFile(relativeFilePath, content) {
    const fullPath = path.resolve(this.repoPath, relativeFilePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
    return fullPath;
  }

  readProjectFile(relativeFilePath) {
    const fullPath = path.resolve(this.repoPath, relativeFilePath);
    if (!fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath, 'utf8');
  }

  commitChanges(message, files = []) {
    try {
      if (files.length > 0) {
        for (const file of files) {
          execSync(`git add "${file}"`, { cwd: this.repoPath, stdio: 'pipe' });
        }
      } else {
        execSync('git add PROJECT_STATE.json PROJECT_STATE.md TASK_QUEUE.json CHANGELOG.md', {
          cwd: this.repoPath,
          stdio: 'pipe'
        });
      }

      // Check if there are staged changes
      const status = execSync('git status --porcelain', { cwd: this.repoPath, stdio: 'pipe' }).toString();
      if (!status.trim()) {
        return { committed: false, hash: this.getLatestCommitHash(), message: 'No changes to commit' };
      }

      execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
        cwd: this.repoPath,
        stdio: 'pipe'
      });

      const newHash = this.getLatestCommitHash();
      return { committed: true, hash: newHash, message };
    } catch (err) {
      return { committed: false, error: err.message, hash: this.getLatestCommitHash() };
    }
  }
}
