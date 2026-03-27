"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ password })
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "登录失败。");
      }

      router.replace("/xhs");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "登录失败。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label className="field">
        <span>操作口令</span>
        <input
          autoComplete="current-password"
          name="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="输入内部操作口令"
        />
      </label>
      {error ? <p className="error-banner">{error}</p> : null}
      <button className="primary-button" type="submit" disabled={!password.trim() || isSubmitting}>
        {isSubmitting ? "登录中..." : "进入控制台"}
      </button>
    </form>
  );
}
