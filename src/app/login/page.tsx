import { LoginForm } from "../../components/login-form";

export default function LoginPage() {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">marketing_fox</p>
        <h1>操作员登录</h1>
        <p className="auth-copy">
          这个控制台只给内部操作员使用。输入口令后，页面会写入一个 HttpOnly 会话 Cookie。
        </p>
        <LoginForm />
      </section>
    </main>
  );
}
