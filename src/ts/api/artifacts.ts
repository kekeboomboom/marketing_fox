import fs from "node:fs";
import path from "node:path";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";

import { badRequest, notFound } from "./errors.js";
import type { ArtifactContent, JobArtifact, JobArtifactType, JobRecord } from "./types.js";

export interface ArtifactCreateInput {
  artifactPath: string;
  type: JobArtifactType;
  artifactsDir: string;
  cwd?: string;
}

export function createArtifact(input: ArtifactCreateInput): JobArtifact | null {
  const cwd = input.cwd ?? process.cwd();
  const absolutePath = path.resolve(cwd, input.artifactPath);
  const normalizedPath = normalizeArtifactPath(absolutePath, input.artifactsDir, cwd);
  if (!normalizedPath) {
    return null;
  }

  const extension = path.extname(normalizedPath).toLowerCase();

  return {
    id: `artifact_${randomUUID().replaceAll("-", "")}`,
    type: input.type,
    path: normalizedPath,
    content_type: extensionToMimeType(extension),
    created_at: new Date().toISOString()
  };
}

export function mergeArtifacts(existing: JobArtifact[], next: JobArtifact[]): JobArtifact[] {
  const merged = [...existing];
  const knownPaths = new Set(existing.map((artifact) => artifact.path));
  for (const artifact of next) {
    if (knownPaths.has(artifact.path)) {
      continue;
    }
    merged.push(artifact);
    knownPaths.add(artifact.path);
  }
  return merged;
}

export function readArtifactContent(job: JobRecord, artifactId: string, cwd: string = process.cwd()): ArtifactContent {
  const artifact = job.artifacts.find((item) => item.id === artifactId);
  if (!artifact) {
    throw notFound("artifact_not_found", "No artifact exists for the requested id.");
  }

  const absolutePath = path.resolve(cwd, artifact.path);
  if (!fs.existsSync(absolutePath)) {
    throw notFound("artifact_not_found", "Artifact file is no longer available.");
  }

  const content = fs.readFileSync(absolutePath);
  return {
    content,
    contentType: artifact.content_type,
    fileName: basename(absolutePath)
  };
}

function normalizeArtifactPath(absolutePath: string, artifactsDir: string, cwd: string): string | null {
  const root = path.resolve(artifactsDir);
  const normalizedRoot = ensureTrailingSeparator(root);
  const normalizedCandidate = absolutePath;

  if (normalizedCandidate !== root && !normalizedCandidate.startsWith(normalizedRoot)) {
    return null;
  }

  const relativeToCwd = path.relative(cwd, normalizedCandidate);
  if (!relativeToCwd || relativeToCwd.startsWith("..")) {
    throw badRequest("invalid_request", "Artifact path must be inside the current working tree.");
  }

  return relativeToCwd.replaceAll("\\", "/");
}

function ensureTrailingSeparator(value: string): string {
  return value.endsWith(path.sep) ? value : `${value}${path.sep}`;
}

function extensionToMimeType(extension: string): string {
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  if (extension === ".json") {
    return "application/json";
  }
  return "application/octet-stream";
}
