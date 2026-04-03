"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { getTrackedJobId, hasActiveXhsBrowserJob, hasJobReachedStatus } from "../lib/xhs-console-state";

type SessionStatus = "logged_in" | "login_required" | "failed";
type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
type ProgressPhase =
  | "starting"
  | "opening_publish_page"
  | "capturing_initial_state"
  | "awaiting_qr_scan"
  | "awaiting_sms_or_challenge"
  | "verifying_session"
  | "completed"
  | "timed_out"
  | "failed"
  | "checking_session"
  | "publishing";

interface ApiErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
  meta?: Record<string, unknown>;
}

interface JobArtifact {
  id: string;
  type: string;
  path: string;
  content_type?: string | null;
  created_at?: string | null;
}

interface JobProgress {
  phase?: ProgressPhase | null;
  state?: string | null;
  status?: SessionStatus | null;
  status_message?: string | null;
  platform_url?: string | null;
  artifacts?: JobArtifact[];
  live_artifacts?: JobArtifact[];
  logs_tail?: string[];
}

interface JobRecord {
  id: string;
  kind: "publish" | "xhs_session_login";
  status: JobStatus;
  request: {
    platform: string;
    mode: string | null;
  };
  result: {
    status?: string;
    platform_url?: string | null;
    platform_post_id?: string | null;
    logs?: string[];
    screenshots?: string[];
  } | null;
  error: ApiErrorPayload | null;
  artifacts: JobArtifact[];
  logs_tail: string[];
  progress?: JobProgress | null;
  created_at: string;
  updated_at: string;
}

interface SessionResult {
  status: SessionStatus;
  logged_in: boolean;
  profile_dir: string;
  platform_url?: string | null;
  screenshots: string[];
  logs: string[];
  artifacts?: JobArtifact[];
  error?: ApiErrorPayload | null;
}

const DRAFT_KEY = "marketing_fox:xhs:content";
const PENDING_PAYLOAD_KEY = "marketing_fox:xhs:pending-publish";
const LOGIN_JOB_KEY = "marketing_fox:xhs:login-job-id";
const PUBLISH_JOB_KEY = "marketing_fox:xhs:publish-job-id";

export function XhsConsole() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [content, setContent] = useState("");
  const [session, setSession] = useState<SessionResult | null>(null);
  const [sessionCheckedAt, setSessionCheckedAt] = useState<string | null>(null);
  const [loginJob, setLoginJob] = useState<JobRecord | null>(null);
  const [publishJob, setPublishJob] = useState<JobRecord | null>(null);
  const [uiError, setUiError] = useState<string | null>(null);
  const [actionState, setActionState] = useState<"idle" | "checking" | "logging_in" | "publishing" | "done">("idle");
  const [isRefreshingSession, setIsRefreshingSession] = useState(false);
  const attachedJobsRef = useRef<{ loginId: string | null; publishId: string | null }>({
    loginId: null,
    publishId: null
  });
  const jobStatusRef = useRef<{ loginStatus: JobStatus | null; publishStatus: JobStatus | null }>({
    loginStatus: null,
    publishStatus: null
  });
  const sessionRefreshInFlightRef = useRef(false);

  useEffect(() => {
    const cachedDraft = window.localStorage.getItem(DRAFT_KEY);
    if (cachedDraft) {
      setContent(cachedDraft);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(DRAFT_KEY, content);
  }, [content]);

  useEffect(() => {
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const loginId = getTrackedJobId(loginJob);
    const publishId = getTrackedJobId(publishJob);
    attachedJobsRef.current = { loginId, publishId };
    jobStatusRef.current = {
      loginStatus: loginJob?.status ?? null,
      publishStatus: publishJob?.status ?? null
    };

    if (loginId) {
      window.localStorage.setItem(LOGIN_JOB_KEY, loginId);
    } else {
      window.localStorage.removeItem(LOGIN_JOB_KEY);
    }

    if (publishId) {
      window.localStorage.setItem(PUBLISH_JOB_KEY, publishId);
    } else {
      window.localStorage.removeItem(PUBLISH_JOB_KEY);
    }
  }, [loginJob?.id, publishJob?.id]);

  useEffect(() => {
    if (!authChecked) {
      return;
    }

    const interval = window.setInterval(() => {
      const { loginId, publishId } = attachedJobsRef.current;
      if (loginId) {
        void refreshJob(loginId, "login");
      }
      if (publishId) {
        void refreshJob(publishId, "publish");
      }
    }, 1500);

    return () => window.clearInterval(interval);
  }, [authChecked]);

  async function bootstrap() {
    try {
      const authResponse = await fetch("/api/auth/session", {
        cache: "no-store"
      });
      if (authResponse.status === 401) {
        router.replace("/login");
        return;
      }

      const authPayload = await readJsonResponse<{ authenticated?: boolean }>(authResponse);
      if (!authPayload.authenticated) {
        router.replace("/login");
        return;
      }

      setAuthChecked(true);
      const attached = await attachActiveJobs();
      if (!hasActiveXhsBrowserJob(attached.loginJob, attached.publishJob)) {
        const sessionSnapshot = await refreshSession(false);
        if (sessionSnapshot && !sessionSnapshot.logged_in && sessionSnapshot.status === "login_required") {
          await ensureLoginJob();
        }
      }
    } catch (error) {
      setUiError(error instanceof Error ? error.message : "无法初始化控制台。");
    }
  }

  async function attachActiveJobs(): Promise<{ loginJob: JobRecord | null; publishJob: JobRecord | null }> {
    const loginJobId = window.localStorage.getItem(LOGIN_JOB_KEY);
    const publishJobId = window.localStorage.getItem(PUBLISH_JOB_KEY);
    let resolvedLoginJob: JobRecord | null = null;
    let resolvedPublishJob: JobRecord | null = null;

    if (loginJobId) {
      resolvedLoginJob = await refreshJob(loginJobId, "login");
    }
    if (publishJobId) {
      resolvedPublishJob = await refreshJob(publishJobId, "publish");
    }

    const response = await fetch("/api/v1/jobs?platform=xiaohongshu&status=active&limit=10", {
      cache: "no-store"
    });
    if (!response.ok) {
      return {
        loginJob: resolvedLoginJob,
        publishJob: resolvedPublishJob
      };
    }

    const payload = await readJsonResponse<{ jobs?: JobRecord[] }>(response);
    const jobs = payload.jobs ?? [];
    const activeLogin = jobs.find((job) => job.kind === "xhs_session_login");
    const activePublish = jobs.find((job) => job.kind === "publish");
    const shouldAdoptActiveLogin =
      !!activeLogin && (!resolvedLoginJob || (resolvedLoginJob.status !== "queued" && resolvedLoginJob.status !== "running"));
    const shouldAdoptActivePublish =
      !!activePublish && (!resolvedPublishJob || (resolvedPublishJob.status !== "queued" && resolvedPublishJob.status !== "running"));

    if (shouldAdoptActiveLogin) {
      setLoginJob(activeLogin);
      resolvedLoginJob = activeLogin;
    }
    if (shouldAdoptActivePublish) {
      setPublishJob(activePublish);
      resolvedPublishJob = activePublish;
    }

    return {
      loginJob: resolvedLoginJob,
      publishJob: resolvedPublishJob
    };
  }

  async function refreshSession(withIndicator = true, force = false): Promise<SessionResult | null> {
    if (!force && hasActiveXhsBrowserJob(loginJob, publishJob)) {
      return session;
    }
    if (sessionRefreshInFlightRef.current) {
      return session;
    }
    sessionRefreshInFlightRef.current = true;
    if (withIndicator) {
      setIsRefreshingSession(true);
    }

    try {
      const response = await fetch("/api/v1/xhs/session/check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({}),
        cache: "no-store"
      });

      if (response.status === 401) {
        router.replace("/login");
        return null;
      }

      const payload = await readJsonResponse<{ session?: SessionResult; error?: ApiErrorPayload }>(response);
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "无法读取小红书登录状态。");
      }
      if (!payload.session) {
        throw new Error("会话检查接口没有返回 session。");
      }

      setSession(payload.session);
      setSessionCheckedAt(new Date().toISOString());
      return payload.session;
    } catch (error) {
      setUiError(error instanceof Error ? error.message : "无法读取小红书登录状态。");
      return null;
    } finally {
      sessionRefreshInFlightRef.current = false;
      if (withIndicator) {
        setIsRefreshingSession(false);
      }
    }
  }

  async function refreshJob(jobId: string, target: "login" | "publish"): Promise<JobRecord | null> {
    const response = await fetch(`/api/v1/jobs/${encodeURIComponent(jobId)}`, {
      cache: "no-store"
    });
    if (response.status === 404) {
      if (target === "login") {
        setLoginJob(null);
      } else {
        setPublishJob(null);
      }
      return null;
    }
    if (response.status === 401) {
      router.replace("/login");
      return null;
    }

    const payload = await readJsonResponse<{ job?: JobRecord; error?: ApiErrorPayload }>(response);
    if (!response.ok || !payload.job) {
      return null;
    }

    if (target === "login") {
      const previousStatus = jobStatusRef.current.loginStatus;
      jobStatusRef.current.loginStatus = payload.job.status;
      setLoginJob(payload.job);
      if (hasJobReachedStatus(previousStatus, payload.job.status, "succeeded")) {
        const sessionSnapshot = await refreshSession(false, true);
        if (sessionSnapshot?.logged_in) {
          setLoginJob(null);
        }
        const resumedPublish = await maybeResumePublish();
        if (!resumedPublish) {
          setActionState("idle");
        }
      }
      if (
        hasJobReachedStatus(previousStatus, payload.job.status, "failed") ||
        hasJobReachedStatus(previousStatus, payload.job.status, "cancelled")
      ) {
        setActionState("idle");
      }
    } else {
      const previousStatus = jobStatusRef.current.publishStatus;
      jobStatusRef.current.publishStatus = payload.job.status;
      setPublishJob(payload.job);
      if (hasJobReachedStatus(previousStatus, payload.job.status, "succeeded")) {
        setActionState("done");
        window.localStorage.removeItem(PENDING_PAYLOAD_KEY);
        await refreshSession(false, true);
      }
      if (
        hasJobReachedStatus(previousStatus, payload.job.status, "failed") ||
        hasJobReachedStatus(previousStatus, payload.job.status, "cancelled")
      ) {
        setActionState("idle");
      }
    }
    return payload.job;
  }

  async function createPublishJob(sourceIdea: string) {
    const response = await fetch("/api/v1/publish", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        platform: "xiaohongshu",
        source_idea: sourceIdea,
        mode: "publish"
      })
    });

    const payload = await readJsonResponse<{
      job?: JobRecord;
      error?: ApiErrorPayload;
    }>(response);
    if (response.status === 409) {
      const activeJobId = String(payload.error?.meta?.active_job_id ?? "");
      if (activeJobId) {
        await refreshJob(activeJobId, "publish");
        return;
      }
    }
    if (!response.ok || !payload.job) {
      throw new Error(payload.error?.message ?? "创建发布任务失败。");
    }

    setPublishJob(payload.job);
    setActionState("publishing");
  }

  async function ensureLoginJob() {
    if (loginJob && (loginJob.status === "queued" || loginJob.status === "running")) {
      setActionState("logging_in");
      return;
    }
    if (sessionRefreshInFlightRef.current) {
      setActionState("checking");
      setUiError("正在检查登录状态，请稍候再生成二维码。");
      return;
    }

    const response = await fetch("/api/v1/xhs/session/login-bootstrap", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });
    const payload = await readJsonResponse<{ job?: JobRecord; error?: ApiErrorPayload }>(response);
    if (!response.ok || !payload.job) {
      throw new Error(payload.error?.message ?? "无法启动扫码登录。");
    }

    setLoginJob(payload.job);
    setActionState("logging_in");
  }

  async function maybeResumePublish(): Promise<boolean> {
    const raw = window.localStorage.getItem(PENDING_PAYLOAD_KEY);
    if (!raw || publishJob?.status === "running" || publishJob?.status === "queued") {
      return false;
    }

    try {
      const payload = JSON.parse(raw) as { source_idea?: string };
      const sourceIdea = payload.source_idea?.trim() ?? "";
      if (!sourceIdea) {
        return false;
      }
      await createPublishJob(sourceIdea);
      return true;
    } catch {
      window.localStorage.removeItem(PENDING_PAYLOAD_KEY);
      return false;
    }
  }

  async function handleSend() {
    const sourceIdea = content.trim();
    if (!sourceIdea) {
      return;
    }

    setUiError(null);
    if (getTrackedJobId(loginJob)) {
      setActionState("logging_in");
      window.localStorage.setItem(PENDING_PAYLOAD_KEY, JSON.stringify({ source_idea: sourceIdea }));
      return;
    }
    if (getTrackedJobId(publishJob)) {
      setActionState("publishing");
      window.localStorage.setItem(PENDING_PAYLOAD_KEY, JSON.stringify({ source_idea: sourceIdea }));
      return;
    }
    setActionState("checking");
    window.localStorage.setItem(PENDING_PAYLOAD_KEY, JSON.stringify({ source_idea: sourceIdea }));

    try {
      const response = await fetch("/api/v1/xhs/session/check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      });
      const payload = await readJsonResponse<{ session?: SessionResult; error?: ApiErrorPayload }>(response);
      if (!response.ok || !payload.session) {
        throw new Error(payload.error?.message ?? "无法校验小红书登录状态。");
      }

      setSession(payload.session);
      setSessionCheckedAt(new Date().toISOString());
      if (payload.session.logged_in) {
        await createPublishJob(sourceIdea);
        return;
      }

      await ensureLoginJob();
    } catch (error) {
      setActionState("idle");
      setUiError(error instanceof Error ? error.message : "发送失败。");
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", {
      method: "POST"
    });
    router.replace("/login");
    router.refresh();
  }

  const sessionBadge = useMemo(() => {
    if (loginJob && (loginJob.status === "queued" || loginJob.status === "running")) {
      return {
        label: "等待扫码",
        tone: "warning"
      };
    }
    if (session?.logged_in) {
      return {
        label: "已登录",
        tone: "success"
      };
    }
    if (session?.status === "failed") {
      return {
        label: "状态异常",
        tone: "danger"
      };
    }
    return {
      label: "需要登录",
      tone: "warning"
    };
  }, [loginJob, session]);

  const actionLabel = useMemo(() => {
    if (publishJob?.status === "succeeded") {
      return "已发布";
    }
    switch (actionState) {
      case "checking":
        return "检查登录中";
      case "logging_in":
        return "等待扫码";
      case "publishing":
        return "发布中";
      case "done":
        return "已发布";
      default:
        return "发送";
    }
  }, [actionState, publishJob?.status]);

  const latestArtifacts = useMemo(() => {
    const liveArtifacts = loginJob?.progress?.live_artifacts ?? [];
    return liveArtifacts.length > 0 ? liveArtifacts : loginJob?.artifacts ?? [];
  }, [loginJob]);

  const qrArtifact = latestArtifacts.find(isQrArtifactCandidate) ?? null;
  const finalArtifact = publishJob?.artifacts.at(-1) ?? null;
  const isLoginJobActive = loginJob?.status === "queued" || loginJob?.status === "running";
  const shouldShowLoginArtifact = Boolean(qrArtifact && loginJob && isLoginJobActive && !session?.logged_in);
  const qrArtifactUrl =
    shouldShowLoginArtifact && loginJob && qrArtifact
      ? `/api/v1/jobs/${encodeURIComponent(loginJob.id)}/artifacts/${encodeURIComponent(qrArtifact.id)}`
      : null;
  const sessionHelpMessage =
    loginJob?.progress?.status_message ??
    (session?.logged_in
      ? publishJob && (publishJob.status === "queued" || publishJob.status === "running")
        ? "扫码完成，登录页已收起，系统正在继续发布。"
        : "扫码完成，登录页已收起，当前小红书会话可直接用于发布。"
      : session?.logs?.at(-1) ?? "系统会先检查会话，再决定是否需要扫码登录。");

  return (
    <main className="console-shell">
      <header className="console-header">
        <div>
          <p className="eyebrow">小红书操作台</p>
          <h1>扫码登录与笔记发送</h1>
        </div>
        <div className="header-actions">
          <span className={`status-pill ${sessionBadge.tone}`}>{sessionBadge.label}</span>
          <button
            className="ghost-button"
            type="button"
            onClick={() => void refreshSession(true)}
            disabled={isRefreshingSession || hasActiveXhsBrowserJob(loginJob, publishJob)}
          >
            {isRefreshingSession ? "检查中..." : "重新检查"}
          </button>
          <button className="ghost-button" type="button" onClick={() => void handleLogout()}>
            退出
          </button>
        </div>
      </header>

      <section className="console-grid">
        <article className="panel session-panel">
          <div className="panel-head">
            <h2>连接状态</h2>
            <p>{sessionCheckedAt ? `最近检查：${formatTime(sessionCheckedAt)}` : "等待首次检查"}</p>
          </div>
          <div className="session-card">
            <div className="session-metadata">
              <p>
                <strong>Profile</strong>
                <span>{session?.profile_dir ?? "尚未获取"}</span>
              </p>
              <p>
                <strong>Phase</strong>
                <span>{session?.logged_in && !isLoginJobActive ? "已登录" : humanizePhase(loginJob?.progress?.phase ?? null)}</span>
              </p>
            </div>
            {shouldShowLoginArtifact ? (
              <div className="artifact-frame">
                <img alt="Xiaohongshu login artifact" src={qrArtifactUrl ?? undefined} />
              </div>
            ) : session?.logged_in ? (
              <div className="artifact-placeholder">
                <p>扫码完成后，登录页会自动收起。</p>
                <p>当前账号已经登录，可以继续检查会话或直接进入发布流程。</p>
              </div>
            ) : (
              <div className="artifact-placeholder">
                <p>服务端会在切到二维码登录后，把二维码单独裁出来显示在这里。</p>
              </div>
            )}
            <div className="session-help">
              <p>{sessionHelpMessage}</p>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void ensureLoginJob()}
                disabled={isRefreshingSession || actionState === "checking" || hasActiveXhsBrowserJob(loginJob, publishJob)}
              >
                重新生成二维码
              </button>
            </div>
          </div>
        </article>

        <article className="panel publish-panel">
          <div className="panel-head">
            <h2>发布内容</h2>
            <p>这里输入的内容会直接进入小红书真实发布流程。</p>
          </div>
          <label className="editor">
            <span>笔记正文</span>
            <textarea
              placeholder="输入这次要发布到小红书的内容。点击发送后，若需要登录，页面会先等待你扫码，再自动续跑发布。"
              value={content}
              onChange={(event) => setContent(event.currentTarget.value)}
            />
          </label>
          {uiError ? <p className="error-banner">{uiError}</p> : null}
          <button className="primary-button send-button" type="button" disabled={!content.trim()} onClick={() => void handleSend()}>
            {actionLabel}
          </button>
        </article>
      </section>

      <section className="panel timeline-panel">
        <div className="panel-head">
          <h2>任务面板</h2>
          <p>显示当前登录任务、发布任务、日志和结果。</p>
        </div>

        <div className="timeline-grid">
          <div className="timeline-column">
            <h3>当前任务</h3>
            <ul className="timeline-list">
              <li>
                <span>登录任务</span>
                <strong>{loginJob ? `${loginJob.status} · ${humanizePhase(loginJob.progress?.phase ?? null)}` : "无"}</strong>
              </li>
              <li>
                <span>发布任务</span>
                <strong>{publishJob ? `${publishJob.status} · ${publishJob.result?.status ?? "等待中"}` : "无"}</strong>
              </li>
            </ul>
          </div>
          <div className="timeline-column">
            <h3>最近日志</h3>
            <div className="log-box">
              {(publishJob?.logs_tail ?? loginJob?.logs_tail ?? session?.logs ?? []).slice(-8).map((logLine, index) => (
                <p key={`${logLine}-${index}`}>{logLine}</p>
              ))}
            </div>
          </div>
          <div className="timeline-column">
            <h3>结果</h3>
            {publishJob?.status === "succeeded" ? (
              <div className="result-card">
                <p className="result-state">已发布</p>
                <p>{publishJob.result?.platform_url ? <a href={publishJob.result.platform_url}>查看平台结果</a> : "平台未返回可访问链接。"}</p>
                {finalArtifact ? (
                  <a
                    className="artifact-link"
                    href={`/api/v1/jobs/${encodeURIComponent(publishJob.id)}/artifacts/${encodeURIComponent(finalArtifact.id)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    打开最终截图
                  </a>
                ) : null}
              </div>
            ) : publishJob?.error ? (
              <div className="result-card failure">
                <p className="result-state">发布失败</p>
                <p>{publishJob.error.message}</p>
              </div>
            ) : (
              <div className="result-card muted">
                <p>还没有发布结果。</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function isQrArtifactCandidate(artifact: JobArtifact): boolean {
  return artifact.type === "qr" || artifact.path.includes("login-qr");
}

function humanizePhase(phase: string | null): string {
  switch (phase) {
    case "awaiting_qr_scan":
      return "等待扫码";
    case "awaiting_sms_or_challenge":
      return "等待短信或验证";
    case "verifying_session":
      return "验证登录";
    case "completed":
      return "已完成";
    case "timed_out":
      return "扫码超时";
    case "publishing":
      return "发布中";
    case "checking_session":
      return "检查登录";
    case "starting":
      return "启动中";
    case "opening_publish_page":
      return "打开发布页";
    case "capturing_initial_state":
      return "采集登录状态";
    case "failed":
      return "失败";
    default:
      return "空闲";
  }
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const raw = await response.text();
  if (!raw.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    if (!response.ok) {
      throw new Error(raw.trim());
    }
    throw new Error("服务端返回了无法解析的 JSON 响应。");
  }
}
