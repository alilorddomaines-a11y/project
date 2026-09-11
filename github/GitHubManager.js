/**
 * github/GitHubManager.js
 * Hardened GitHub & Git repository manager.
 * Canonical repo: https://github.com/alilorddomaines-a11y/project.git
 * 
 * Rules:
 * - Never store or expose secrets/tokens in code.
 * - Never create or switch to another repository.
 * - Never pretend a push succeeded if it failed.
 * - Supports inspecting local filesystem, committed Git state, and remote GitHub state.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export class GitHubManager {
  constructor(config = {}) {
    this.repoPath = config.repoPath || process.cwd();
    this.canonicalRemoteUrl = 'https://github.com/alilorddomaines-a11y/project.git';
    this.branch = config.branch || 'main';
  }

  getWorkingTreeStatus() {
    try {
      return execSync('git status --porcelain', { cwd: this.repoPath, stdio: 'pipe' })
        .toString()
        .trim();
    } catch (e) {
      return `ERROR: ${e.message}`;
    }
  }

  isWorkingTreeClean() {
    return this.getWorkingTreeStatus() === '';
  }

  getLatestCommitHash() {
    try {
      return execSync('git rev-parse HEAD', { cwd: this.repoPath, stdio: 'pipe' })
        .toString()
        .trim();
    } catch {
      return null;
    }
  }

  getRemoteUrl() {
    try {
      return execSync('git config --get remote.origin.url', { cwd: this.repoPath, stdio: 'pipe' })
        .toString()
        .trim();
    } catch {
      return null;
    }
  }

  verifyCanonicalRemote() {
    const current = this.getRemoteUrl();
    if (!current) {
      throw new Error('No remote origin configured.');
    }
    const cleanCurrent = current.replace(/\.git$/, '').toLowerCase();
    const cleanExpected = this.canonicalRemoteUrl.replace(/\.git$/, '').toLowerCase();
    if (!cleanCurrent.includes('alilorddomaines-a11y/project')) {
      throw new Error(`Remote origin mismatch: expected ${this.canonicalRemoteUrl}, found ${current}`);
    }
    return true;
  }

  isRemoteReachable(timeoutMs = 5000) {
    try {
      execSync(`git ls-remote --exit-code origin HEAD`, {
        cwd: this.repoPath,
        stdio: 'pipe',
        timeout: timeoutMs
      });
      return true;
    } catch {
      return false;
    }
  }

  getRemoteCommitHash(branch = 'main', timeoutMs = 8000) {
    try {
      const output = execSync(`git ls-remote origin refs/heads/${branch}`, {
        cwd: this.repoPath,
        stdio: 'pipe',
        timeout: timeoutMs
      }).toString().trim();
      if (!output) return null;
      return output.split(/\s+/)[0] || null;
    } catch {
      return null;
    }
  }

  writeProjectFile(relativeFilePath, content) {
    const fullPath = path.resolve(this.repoPath, relativeFilePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const serialized = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    fs.writeFileSync(fullPath, serialized, 'utf8');
    return fullPath;
  }

  readLocalFile(relativeFilePath) {
    const fullPath = path.resolve(this.repoPath, relativeFilePath);
    if (!fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath, 'utf8');
  }

  readCommittedFile(relativeFilePath, commitRef = 'HEAD') {
    try {
      // Normalize slashes for git
      const gitPath = relativeFilePath.replace(/\\/g, '/');
      return execSync(`git show ${commitRef}:"${gitPath}"`, {
        cwd: this.repoPath,
        stdio: 'pipe'
      }).toString();
    } catch (e) {
      return null;
    }
  }

  commitFiles(files, message) {
    for (const f of files) {
      execSync(`git add "${f}"`, { cwd: this.repoPath, stdio: 'pipe' });
    }

    const status = execSync('git status --porcelain', { cwd: this.repoPath, stdio: 'pipe' }).toString();
    if (!status.trim()) {
      return {
        committed: false,
        hash: this.getLatestCommitHash(),
        message: 'No changes to commit'
      };
    }

    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: this.repoPath,
      stdio: 'pipe'
    });

    return {
      committed: true,
      hash: this.getLatestCommitHash(),
      message
    };
  }

  pushToRemote(branch = 'main', timeoutMs = 15000) {
    this.verifyCanonicalRemote();

    try {
      // Use non-interactive flag to prevent hanging on prompts
      execSync(`git -c credential.interactive=never push origin ${branch}`, {
        cwd: this.repoPath,
        stdio: 'pipe',
        timeout: timeoutMs
      });

      return {
        pushed: true,
        branch,
        commitHash: this.getLatestCommitHash(),
        error: null
      };
    } catch (err) {
      return {
        pushed: false,
        branch,
        commitHash: this.getLatestCommitHash(),
        error: err.stderr ? err.stderr.toString().trim() : err.message
      };
    }
  }
}
