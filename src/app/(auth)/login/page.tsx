// src/app/(auth)/login/page.tsx
// Ενιαία σελίδα σύνδεσης για όλους τους ρόλους

"use client";

import { useState } from "react";
import { Eye, EyeOff, Zap, Car } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    if (!email || !password) {
      setError("Συμπληρώστε email και κωδικό");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Σφάλμα σύνδεσης");
        return;
      }

      window.location.href = data.data.redirectTo;
    } catch {
      setError("Σφάλμα σύνδεσης. Δοκιμάστε ξανά.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-root">
      {/* Left Panel */}
      <div className="login-left">
        <div className="login-brand">
          <div className="login-logo">
            <Zap size={24} />
          </div>
          <span>FleetPro</span>
        </div>

        <div className="login-hero">
          <h1>
            Διαχείριση στόλου
            <br />
            <span className="login-accent">χωρίς όρια</span>
          </h1>
          <p>
            Η πλατφόρμα που χρειάζεται κάθε εταιρία ενοικίασης οχημάτων
            για να λειτουργεί αποδοτικά και επαγγελματικά.
          </p>
        </div>

        <div className="login-features">
          {[
            "Multi-tenant αρχιτεκτονική",
            "Ηλεκτρονικά συμβόλαια & υπογραφές",
            "Σύστημα εκπτώσεων & προσφορών",
            "Αναφορές & στατιστικά σε πραγματικό χρόνο",
          ].map((f) => (
            <div key={f} className="login-feature">
              <span className="login-dot" />
              {f}
            </div>
          ))}
        </div>

        <div className="login-cars">
          <Car size={120} strokeWidth={0.5} className="login-car-icon" />
        </div>
      </div>

      {/* Right Panel */}
      <div className="login-right">
        <div className="login-form-wrap">
          <div className="login-form-header">
            <h2>Καλώς ήρθατε</h2>
            <p>Συνδεθείτε με τον λογαριασμό σας</p>
          </div>

          <div className="login-form">
            <label className="login-label">
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                placeholder="email@company.gr"
                className="login-input"
                autoFocus
              />
            </label>

            <label className="login-label">
              Κωδικός Πρόσβασης
              <div className="login-password-wrap">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  placeholder="••••••••"
                  className="login-input"
                />
                <button
                  type="button"
                  className="login-eye"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            {error && <div className="login-error">{error}</div>}

            <button
              className="login-btn"
              onClick={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <span className="login-spinner" />
              ) : (
                "Σύνδεση"
              )}
            </button>
          </div>

          <div className="login-hint">
            <p>Δεν έχετε λογαριασμό;</p>
            <a href="mailto:support@fleetpro.gr">Επικοινωνήστε μαζί μας</a>
          </div>

          {/* Demo accounts */}
          <div className="login-demo">
            <div className="login-demo-title">Demo λογαριασμοί</div>
            {[
              { role: "Super Admin", email: "superadmin@fleetpro.gr", pass: "FleetPro2025!" },
              { role: "Company Admin", email: "admin@prentals.gr", pass: "Admin2025!" },
              { role: "Staff", email: "staff@prentals.gr", pass: "Staff2025!" },
            ].map((demo) => (
              <button
                key={demo.role}
                className="login-demo-btn"
                onClick={() => {
                  setEmail(demo.email);
                  setPassword(demo.pass);
                }}
              >
                <span className="login-demo-role">{demo.role}</span>
                <span className="login-demo-email">{demo.email}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <style>{loginStyles}</style>
    </div>
  );
}

const loginStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .login-root {
    min-height: 100vh;
    display: flex;
    font-family: 'Inter', sans-serif;
    background: #0a0a0f;
  }

  /* Left */
  .login-left {
    width: 480px;
    min-height: 100vh;
    background: linear-gradient(135deg, #0f0f1a 0%, #1a0a2e 100%);
    padding: 40px;
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
    border-right: 1px solid #1e1e2e;
    flex-shrink: 0;
  }

  .login-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 20px;
    font-weight: 800;
    color: #fff;
  }

  .login-logo {
    width: 40px; height: 40px;
    background: #6366f1;
    border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    color: #fff;
  }

  .login-hero {
    margin-top: auto;
  }

  .login-hero h1 {
    font-size: 40px;
    font-weight: 800;
    color: #fff;
    line-height: 1.15;
    margin-bottom: 16px;
  }

  .login-accent {
    background: linear-gradient(135deg, #818cf8, #a78bfa);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .login-hero p {
    font-size: 14px;
    color: #64748b;
    line-height: 1.6;
    max-width: 340px;
  }

  .login-features {
    margin-top: 32px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: auto;
  }

  .login-feature {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: #94a3b8;
  }

  .login-dot {
    width: 6px; height: 6px;
    background: #6366f1;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .login-cars {
    position: absolute;
    bottom: -20px;
    right: -20px;
    opacity: 0.04;
    color: #fff;
    pointer-events: none;
  }

  /* Right */
  .login-right {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px;
    background: #0a0a0f;
  }

  .login-form-wrap {
    width: 100%;
    max-width: 380px;
  }

  .login-form-header {
    margin-bottom: 32px;
  }

  .login-form-header h2 {
    font-size: 26px;
    font-weight: 800;
    color: #fff;
    margin-bottom: 6px;
  }

  .login-form-header p {
    font-size: 13px;
    color: #475569;
  }

  .login-form { display: flex; flex-direction: column; gap: 16px; }

  .login-label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
    font-weight: 500;
    color: #64748b;
  }

  .login-input {
    background: #0f0f1a;
    border: 1px solid #2a2a3e;
    border-radius: 10px;
    padding: 12px 14px;
    color: #e2e8f0;
    font-size: 14px;
    outline: none;
    transition: border-color 0.15s;
    font-family: inherit;
    width: 100%;
  }
  .login-input:focus { border-color: #6366f1; }
  .login-input::placeholder { color: #334155; }

  .login-password-wrap { position: relative; }
  .login-password-wrap .login-input { padding-right: 44px; }
  .login-eye {
    position: absolute;
    right: 12px; top: 50%;
    transform: translateY(-50%);
    background: none; border: none;
    color: #475569; cursor: pointer;
    display: flex; align-items: center;
    transition: color 0.1s;
  }
  .login-eye:hover { color: #94a3b8; }

  .login-error {
    background: #450a0a;
    border: 1px solid #7f1d1d;
    border-radius: 8px;
    padding: 10px 12px;
    color: #fca5a5;
    font-size: 12px;
  }

  .login-btn {
    background: #6366f1;
    color: #fff;
    border: none;
    border-radius: 10px;
    padding: 13px;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 46px;
    margin-top: 4px;
  }
  .login-btn:hover:not(:disabled) { background: #4f46e5; transform: translateY(-1px); }
  .login-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .login-spinner {
    width: 18px; height: 18px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .login-hint {
    margin-top: 20px;
    text-align: center;
    font-size: 12px;
    color: #475569;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  .login-hint a { color: #818cf8; text-decoration: none; }
  .login-hint a:hover { text-decoration: underline; }

  .login-demo {
    margin-top: 24px;
    background: #0f0f1a;
    border: 1px solid #1e1e2e;
    border-radius: 12px;
    padding: 14px;
  }

  .login-demo-title {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #475569;
    margin-bottom: 10px;
  }

  .login-demo-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 8px 10px;
    background: none;
    border: none;
    border-radius: 7px;
    cursor: pointer;
    transition: background 0.1s;
  }
  .login-demo-btn:hover { background: #1a1a2e; }
  .login-demo-role { font-size: 11px; font-weight: 600; color: #94a3b8; }
  .login-demo-email { font-size: 10px; color: #475569; font-family: monospace; }

  @media (max-width: 900px) {
    .login-left { display: none; }
  }
`;
