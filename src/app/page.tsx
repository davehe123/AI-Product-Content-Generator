"use client";

import { useState, useEffect } from "react";
import { exportToPDF, exportToCSV } from "./utils/export";

const WORKER_URL = "https://ai-product-content-generator-api.deforde159.workers.dev";

const PLAN_NAMES: Record<string, string> = {
  free: "Free",
  starter: "Starter",
  pro: "Pro",
  business: "Business",
};

const PACKAGES = [
  { key: "Starter Pack", credits: 10, price: 1 },
  { key: "Small Pack", credits: 60, price: 5 },
  { key: "Medium Pack", credits: 200, price: 15 },
  { key: "Large Pack", credits: 600, price: 39 },
];

interface User {
  id: string;
  email: string;
  name: string;
  picture: string;
  subscription_plan: string;
  subscription_status: string;
  monthly_credits: number;
  monthly_used: number;
  monthly_remaining: number;
  package_remaining: number;
  credits_remaining: number;
}

interface GenerateResult {
  title: string;
  bulletPoints: string[];
  description: string;
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// 从 Cookie 中读取 session_token as localStorage 的备份
function getSessionTokenFromCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/session_token=([^;]+)/);
  return match ? match[1] : null;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeMessage, setUpgradeMessage] = useState("");
  
  const [formData, setFormData] = useState({
    productName: "",
    brandName: "",
    features: "",
    audience: "",
    keywords: "",
    tone: "persuasive",
    platform: "amazon",
    language: "english",
    category: "other",
    style: "standard",
  });

  // 模板配置
  const categories = [
    { id: "electronics", name: "📱 Electronics", nameEn: "Electronics" },
    { id: "clothing", name: "👕 Clothing & Accessories", nameEn: "Clothing" },
    { id: "home", name: "🏠 Home & Kitchen", nameEn: "Home & Kitchen" },
    { id: "beauty", name: "💄 Beauty", nameEn: "Beauty" },
    { id: "sports", name: "⚽ Sports & Outdoors", nameEn: "Sports" },
    { id: "baby", name: "👶 Baby & Toys", nameEn: "Baby & Toys" },
    { id: "food", name: "🍎 Food & Beverages", nameEn: "Food" },
    { id: "other", name: "📦 Other", nameEn: "Other" },
  ];

  const styles = [
    { id: "standard", name: "📋 Standard Amazon", desc: "Classic Amazon Style" },
    { id: "high_conversion", name: "🚀 High Conversion", desc: "FOMO-driven" },
    { id: "premium", name: "✨ Premium Luxury", desc: "Premium & Elegant" },
    { id: "social", name: "📱 Social Media", desc: "Fast & Viral" },
  ];

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  // Buy credits modal
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [buyingPackage, setBuyingPackage] = useState<string | null>(null);
  const [buyLoading, setBuyLoading] = useState(false);
  const [buySuccess, setBuySuccess] = useState(false);
  const [buyError, setBuyError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    const authData = params.get("auth_data");
    const authCallback = params.get("auth_callback");
    const oauthError = params.get("error");

    // 处理 OAuth 回调带回的 auth_data
    if (authCallback === "1" && authData) {
      (async () => {
        try {
          const padded = authData + "=".repeat((4 - (authData.length % 4)) % 4);
          const jsonStr = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
          const data = JSON.parse(jsonStr);
          localStorage.setItem("auth_token", data.token);

          // 用 token 获取完整的用户信息（含Credits）
          const meRes = await fetch(`${WORKER_URL}/auth/me`, {
            headers: { Authorization: `Bearer ${data.token}` },
          });
          const meData = await meRes.json();
          if (meData.authenticated) {
            localStorage.setItem("auth_user", JSON.stringify(meData.user));
            setUser(meData.user);
            setAuthenticated(true);
          } else {
            setError("Login failed. Please try again.");
          }
        } catch (err) {
          console.error("Failed to parse auth_data:", err);
          setError("Login failed. Please try again.");
        }
        window.history.replaceState({}, "", "/");
        setCheckingAuth(false);
        // Login success，Close popup 并通知主窗口Refresh
        if (window.opener && !window.opener.closed) {
          window.opener.location.reload();
        }
        window.close();
      })();
      return;
    }

    // Resuming login state
    const storedUser = localStorage.getItem("auth_user");
    const token = localStorage.getItem("auth_token");
    
    if (storedUser && token) {
      try {
        setUser(JSON.parse(storedUser));
        setAuthenticated(true);
      } catch {
        localStorage.removeItem("auth_user");
        localStorage.removeItem("auth_token");
      }
    }
    
    // 只有在非 auth_callback 的情况下才Show error
    if (oauthError) {
      const detail = new URLSearchParams(window.location.search).get("detail") || "";
      setError("Google login failed: " + oauthError + (detail ? " | " + detail : ""));
      window.history.replaceState({}, "", "/?");
    }
    
    setCheckingAuth(false);
  }, []);

  // postMessage 监听已移除，改用 URL 参数回传

  const checkAuth = async () => {
    const token = localStorage.getItem("auth_token");
    if (!token) {
      setCheckingAuth(false);
      return;
    }
    
    try {
      const res = await fetch(`${WORKER_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.authenticated) {
        setUser(data.user);
        setAuthenticated(true);
        localStorage.setItem("auth_user", JSON.stringify(data.user));
      } else {
        localStorage.removeItem("auth_token");
        localStorage.removeItem("auth_user");
        setAuthenticated(false);
      }
    } catch (err) {
      console.error("Auth check failed:", err);
    } finally {
      setCheckingAuth(false);
    }
  };

  const handleLogin = () => {
    const frontendUrl = window.location.origin;
    const popup = window.open(
      `${WORKER_URL}/auth/google?frontend_url=${encodeURIComponent(frontendUrl)}`,
      "google_login",
      "width=500,height=600,scrollbars=yes"
    );
  };

  const handleLogout = async () => {
    try {
      await fetch(`${WORKER_URL}/auth/logout`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
    } catch (err) {
      console.error("Logout failed:", err);
    }
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    setAuthenticated(false);
    setUser(null);
    setResult(null);
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch(`${WORKER_URL}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          localStorage.removeItem("auth_token");
          localStorage.removeItem("auth_user");
          setAuthenticated(false);
          throw new Error("Please login again");
        }
        if (response.status === 402 || data.error === "no_credits") {
          setUpgradeMessage(data.message || "Out of Credits");
          setShowUpgradeModal(true);
          return;
        }
        throw new Error(data.error || `Failed (${response.status})`);
      }

      if (!data.data) throw new Error("No data returned");

      setResult(data.data);
      
      // 更新本地CreditsShow
      if (user && data.credits_remaining !== undefined) {
        setUser({ ...user, credits_remaining: data.credits_remaining });
      }

    } catch (err) {
      console.error("Generate error:", err);
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string, section: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(section);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Failed to copy");
    }
  };

  const copyAll = () => {
    if (!result) return;
    const allContent = `Title:\n${result.title}\n\nBullet Points:\n${result.bulletPoints.join("\n")}\n\nDescription:\n${result.description}`;
    copyToClipboard(allContent, "all");
  };

  const handleBuyCredits = async (packageKey: string) => {
    setBuyingPackage(packageKey);
    setBuyLoading(true);
    setBuyError("");
    setBuySuccess(false);

    try {
      // 1. Create PayPal 订单
      const createRes = await fetch(`${WORKER_URL}/api/paypal/create-order`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ package_key: packageKey, frontend_url: window.location.origin }),
      });

      const createData = await createRes.json();

      if (!createRes.ok) {
        throw new Error(createData.error || "Failed to create order");
      }

      // 2. 跳转到 PayPal 授权页面
      window.location.href = createData.approvalUrl;

    } catch (err) {
      setBuyError(err instanceof Error ? err.message : "Payment failed");
      setBuyLoading(false);
      setBuyingPackage(null);
    }
  };

  const handleUpgradePlan = async (planKey: string) => {
    if (!authenticated || !user) return;

    try {
      const res = await fetch(`${WORKER_URL}/api/paypal/create-subscription`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ plan_key: planKey, frontend_url: window.location.origin }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert("Subscription creation failed: " + (data.error || "Unknown error"));
        return;
      }

      // 跳转到 PayPal Subscription Authorization Page
      window.location.href = data.approvalUrl;

    } catch (err) {
      alert("Subscription creation failed: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  };

  // 处理 PayPal Back
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paypalReturn = params.get("paypal_return");
    const paypalCancel = params.get("paypal_cancel");
    const orderId = params.get("orderId");
    const subscriptionReturn = params.get("subscription_return");
    const subscriptionCancel = params.get("subscription_cancel");
    const planKey = params.get("plan");
    const subscriptionId = params.get("subscription_id");

    if (paypalCancel === "1") {
      window.history.replaceState({}, "", "/");
      setShowBuyModal(false);
      setBuyLoading(false);
      setBuyingPackage(null);
      return;
    }

    if (subscriptionCancel === "1") {
      window.history.replaceState({}, "", "/");
      setShowUpgradeModal(false);
      return;
    }

    // PayPal Checkout redirects with token=ORDER_ID (not orderId)
    const effectiveOrderId = orderId || params.get("token");

    if (paypalReturn === "1" && effectiveOrderId) {
      (async () => {
        setBuyLoading(true);
        setBuyError("");
        try {
          const captureRes = await fetch(`${WORKER_URL}/api/paypal/capture-order`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...getAuthHeaders(),
            },
            body: JSON.stringify({ orderId: effectiveOrderId }),
          });

          const captureData = await captureRes.json();

          if (!captureRes.ok) {
            throw new Error(captureData.error || "Capture failed");
          }

          setBuySuccess(true);

          // 从服务器重新获取用户数据确保CreditsRefresh
          await checkAuth();

          // 清理 URL 参数
          window.history.replaceState({}, "", "/");

          // 3Closing in | seconds
          setTimeout(() => {
            setShowBuyModal(false);
            setBuySuccess(false);
            setBuyingPackage(null);
            setBuyLoading(false);
          }, 3000);

        } catch (err) {
          setBuyError(err instanceof Error ? err.message : "Payment capture failed");
          window.history.replaceState({}, "", "/");
          setBuyLoading(false);
        }
      })();
      return;
    }

    // Processing subscription return - PayPal may redirect with token=subscriptionId or our custom subscription_id param
    const effectiveSubscriptionId = subscriptionId || params.get("token");

    // Processing subscription return
    if (subscriptionReturn === "1" && planKey && effectiveSubscriptionId) {
      (async () => {
        try {
          const captureRes = await fetch(`${WORKER_URL}/api/paypal/capture-subscription`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...getAuthHeaders(),
            },
            body: JSON.stringify({ subscriptionId: effectiveSubscriptionId, plan_key: planKey }),
          });

          const captureData = await captureRes.json();

          if (!captureRes.ok) {
            alert("Subscription activation failed: " + (captureData.error || "Unknown error"));
            window.history.replaceState({}, "", "/");
            setShowUpgradeModal(false);
            return;
          }

          // 从服务器重新获取用户数据确保CreditsRefresh
          await checkAuth();

          alert("Success! You've upgraded to " + planKey.toUpperCase());
          window.history.replaceState({}, "", "/");
          setShowUpgradeModal(false);

        } catch (err) {
          alert("Subscription activation failed: " + (err instanceof Error ? err.message : "Unknown error"));
          window.history.replaceState({}, "", "/");
          setShowUpgradeModal(false);
        }
      })();
      return;
    }
  }, []);

  const creditPercent = () => {
    if (!user) return 0;
    const total = user.monthly_credits + user.package_remaining;
    if (total === 0) return 0;
    return Math.round((user.credits_remaining / total) * 100);
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 mx-auto mb-2 text-blue-600" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-slate-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Upgrade */}
      {showUpgradeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 max-w-2xl w-full mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="text-center mb-6">
              <div className="text-5xl mb-4">⚡</div>
              <h2 className="text-2xl font-bold text-slate-800 mb-2">Out of Credits</h2>
              <p className="text-slate-600">{upgradeMessage || "Select a plan that suits you to continue"}</p>
            </div>

            {/* Plan Comparison */}
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              {[
                {
                  name: "Free",
                  price: "$0",
                  period: "Free Forever",
                  credits: "3",
                  features: ["3 free generations", "Basic Templates", "English Support", "Community Support"],
                  highlight: false,
                  cta: "Current Plan",
                },
                {
                  name: "Starter",
                  price: "$5",
                  period: "//mo",
                  credits: "60",
                  features: ["60 Credits/mo", "All Basic Templates", "Bilingual Support", "Email Support", "7 days of history"],
                  highlight: false,
                  cta: "Select Starter",
                },
                {
                  name: "Pro",
                  price: "$15",
                  period: "//mo",
                  credits: "200",
                  features: ["200 Credits/mo", "Advanced Templates", "Multi-language (CN/EN/JP/KR)", "Priority Email Support", "30 days of history", "PDF Export"],
                  highlight: true,
                  cta: "Upgrade to Pro",
                },
                {
                  name: "Business",
                  price: "$39",
                  period: "//mo",
                  credits: "600",
                  features: ["600 Credits/mo", "Enterprise Templates", "Full Language Support", "7×24 PrioritySupport", "90 days of history", "PDF/CSV Export", "API Access"],
                  highlight: false,
                  cta: "Select Business",
                },
              ].map((plan) => (
                <div
                  key={plan.name}
                  className={`p-5 rounded-xl border-2 ${
                    plan.highlight
                      ? "border-blue-500 bg-gradient-to-b from-blue-50 to-white shadow-lg relative"
                      : "border-slate-200 hover:border-blue-300 bg-white"
                  }`}
                >
                  {plan.highlight && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-xs font-medium px-3 py-1 rounded-full">
                      Recommended
                    </div>
                  )}
                  <div className="text-center mb-4">
                    <h3 className={`text-lg font-bold mb-1 ${plan.highlight ? "text-blue-600" : "text-slate-700"}`}>
                      {plan.name}
                    </h3>
                    <div className="flex items-baseline justify-center gap-1">
                      <span className="text-3xl font-bold text-slate-900">{plan.price}</span>
                      <span className="text-slate-500">{plan.period}</span>
                    </div>
                  </div>

                  <div className="text-center mb-4">
                    <div className="inline-flex items-center gap-2 bg-slate-100 rounded-full px-3 py-1">
                      <span className="text-lg">💰</span>
                      <span className="font-semibold text-slate-700">{plan.credits} Credits/mo</span>
                    </div>
                  </div>

                  <ul className="space-y-2 mb-5">
                    {plan.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm text-slate-600">
                        <span className="text-green-500 mt-0.5">✓</span>
                        {feature}
                      </li>
                    ))}
                  </ul>

                  <button
                    className={`w-full py-2.5 px-4 rounded-lg font-semibold transition ${
                      plan.highlight
                        ? "bg-blue-600 hover:bg-blue-700 text-white"
                        : plan.name === "Free"
                        ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                        : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                    }`}
                    disabled={plan.name === "Free"}
                    onClick={() => {
                      if (plan.name !== "Free") {
                        handleUpgradePlan(plan.name.toLowerCase());
                      }
                    }}
                  >
                    {plan.cta}
                  </button>
                </div>
              ))}
            </div>

            <div className="text-center">
              <button
                onClick={() => setShowUpgradeModal(false)}
                className="text-slate-500 hover:text-slate-700 text-sm py-2"
              >
                Maybe Later
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Buy Credits弹窗 */}
      {showBuyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
            <div className="text-center mb-6">
              <div className="text-4xl mb-3">💰</div>
              <h2 className="text-2xl font-bold text-slate-800 mb-2">Buy Credits</h2>
              <p className="text-slate-600 text-sm">SelectCredits进行充值（PayPal 支付）</p>
            </div>

            {buySuccess ? (
              <div className="text-center py-6">
                <div className="text-5xl mb-3">✅</div>
                <h3 className="text-xl font-bold text-green-600 mb-2">Purchase Successful！</h3>
                <p className="text-slate-600">Creditshas been added to your account</p>
              </div>
            ) : (
              <>
                <div className="space-y-3 mb-6">
                  {PACKAGES.map((pkg) => (
                    <button
                      key={pkg.key}
                      onClick={() => handleBuyCredits(pkg.key)}
                      disabled={buyLoading}
                      className={`w-full flex items-center justify-between p-4 rounded-lg border-2 transition ${
                        buyingPackage === pkg.key && buyLoading
                          ? "border-blue-500 bg-blue-50"
                          : "border-slate-200 hover:border-blue-500 hover:bg-blue-50"
                      }`}
                    >
                      <div className="text-left">
                        <p className="font-semibold text-slate-800">{pkg.key}</p>
                        <p className="text-sm text-slate-500">{pkg.credits} Credits</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {buyingPackage === pkg.key && buyLoading ? (
                          <svg className="animate-spin h-5 w-5 text-blue-600" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        ) : (
                          <span className="text-lg font-bold text-green-600">${pkg.price}</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>

                {buyError && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                    {buyError}
                  </div>
                )}

                <button
                  onClick={() => {
                    setShowBuyModal(false);
                    setBuyingPackage(null);
                    setBuyError("");
                  }}
                  disabled={buyLoading}
                  className="w-full mt-2 text-slate-500 hover:text-slate-700 text-sm py-2 disabled:opacity-50"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex-1"></div>
            <h1 className="text-4xl font-bold text-slate-900 mb-3 flex-1">
              AI Product Content Generator
            </h1>
            <div className="flex-1 flex justify-end items-center gap-3">
              {authenticated && user ? (
                <div className="text-right">
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-medium text-slate-700">{user.name || user.email}</p>
                      <p className="text-xs text-blue-600 font-medium">
                        {PLAN_NAMES[user.subscription_plan] || "Free"}
                      </p>
                    </div>
                    {user.picture && (
                      <img src={user.picture} alt={user.name} className="w-10 h-10 rounded-full" />
                    )}
                    <button
                      onClick={handleLogout}
                      className="text-sm bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1.5 rounded-lg transition"
                    >
                      Logout
                    </button>
                    <a
                      href="/profile"
                      className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition"
                    >
                      👤 My Account
                    </a>
                  </div>
                </div>
              ) : (
                <button
                  onClick={handleLogin}
                  className="flex items-center gap-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 px-4 py-2 rounded-lg transition shadow-sm"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Sign in with Google
                </button>
              )}
            </div>
          </div>
          <p className="text-lg text-slate-600">
            Generate high-converting Amazon listings in seconds
          </p>
        </div>

        {/* CreditsShow条 */}
        {authenticated && user && (
          <div className="bg-white rounded-xl shadow-sm p-4 mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-600">Remaining Credits</span>
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-blue-600">
                  {user.credits_remaining} times
                </span>
                <button
                  onClick={() => setShowBuyModal(true)}
                  className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg transition font-medium"
                >
                  Buy Credits
                </button>
              </div>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all"
                style={{ width: `${creditPercent()}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-slate-400 mt-1">
              <span>Used {user.monthly_used} times</span>
              <span>
                {user.monthly_credits > 0 ? `/moAllowance ${user.monthly_remaining} times` : ""}
                {user.package_remaining > 0 ? ` + Credits ${user.package_remaining} times` : ""}
              </span>
            </div>
          </div>
        )}

        {!authenticated && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
            Please login to use.generator（Register and get 3 free generations）
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-8">
          {/* Input Form */}
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <h2 className="text-xl font-semibold text-slate-800 mb-6">
              Product Information
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Product Name *
                </label>
                <input
                  type="text"
                  name="productName"
                  value={formData.productName}
                  onChange={handleChange}
                  required
                  disabled={!authenticated || (user?.credits_remaining ?? 0) <= 0}
                  placeholder="Men's Ice Silk Underwear"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition disabled:bg-slate-100 disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Brand Name
                </label>
                <input
                  type="text"
                  name="brandName"
                  value={formData.brandName}
                  onChange={handleChange}
                  disabled={!authenticated || (user?.credits_remaining ?? 0) <= 0}
                  placeholder="CozyFit"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition disabled:bg-slate-100 disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Key Features * <span className="text-slate-400 text-xs">(comma separated)</span>
                </label>
                <textarea
                  name="features"
                  value={formData.features}
                  onChange={handleChange}
                  required
                  disabled={!authenticated || (user?.credits_remaining ?? 0) <= 0}
                  rows={3}
                  placeholder="breathable, cooling, seamless"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition resize-none disabled:bg-slate-100 disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Target Audience
                </label>
                <input
                  type="text"
                  name="audience"
                  value={formData.audience}
                  onChange={handleChange}
                  disabled={!authenticated || (user?.credits_remaining ?? 0) <= 0}
                  placeholder="men, athletes"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition disabled:bg-slate-100 disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Core Keywords <span className="text-slate-400 text-xs">(for SEO)</span>
                </label>
                <input
                  type="text"
                  name="keywords"
                  value={formData.keywords}
                  onChange={handleChange}
                  disabled={!authenticated || (user?.credits_remaining ?? 0) <= 0}
                  placeholder="ice silk underwear, mens underwear"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition disabled:bg-slate-100 disabled:cursor-not-allowed"
                />
              </div>

              {/* 模板Select */}
              <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-4 mb-4">
                <h3 className="text-sm font-medium text-slate-700 mb-3">🎨 Generate</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setFormData({ ...formData, category: cat.id })}
                      disabled={!authenticated || (user?.credits_remaining ?? 0) <= 0}
                      className={`p-3 rounded-lg border-2 text-left transition ${
                        formData.category === cat.id
                          ? "border-blue-500 bg-white shadow-md"
                          : "border-slate-200 bg-white/50 hover:border-blue-300"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <p className="text-sm font-medium text-slate-800">{cat.name}</p>
                      <p className="text-xs text-slate-400">{cat.nameEn}</p>
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                  {styles.map((sty) => (
                    <button
                      key={sty.id}
                      type="button"
                      onClick={() => setFormData({ ...formData, style: sty.id })}
                      disabled={!authenticated || (user?.credits_remaining ?? 0) <= 0}
                      className={`p-2 rounded-lg border-2 text-left transition ${
                        formData.style === sty.id
                          ? "border-purple-500 bg-white shadow-md"
                          : "border-slate-200 bg-white/50 hover:border-purple-300"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <p className="text-sm font-medium text-slate-800">{sty.name}</p>
                      <p className="text-xs text-slate-400">{sty.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Tone</label>
                  <select
                    name="tone"
                    value={formData.tone}
                    onChange={handleChange}
                    disabled={!authenticated || (user?.credits_remaining ?? 0) <= 0}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition disabled:bg-slate-100 disabled:cursor-not-allowed"
                  >
                    <option value="professional">Professional</option>
                    <option value="persuasive">Persuasive</option>
                    <option value="friendly">Friendly</option>
                    <option value="luxury">Luxury</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Output Language</label>
                  <select
                    name="language"
                    value={formData.language}
                    onChange={handleChange}
                    disabled={!authenticated || (user?.credits_remaining ?? 0) <= 0}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition disabled:bg-slate-100 disabled:cursor-not-allowed"
                  >
                    <option value="english">English</option>
                    <option value="chinese">CN</option>
                    <option value="japanese">Japanese</option>
                    <option value="korean">한국어</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Platform</label>
                  <select
                    name="platform"
                    value={formData.platform}
                    onChange={handleChange}
                    disabled={!authenticated || (user?.credits_remaining ?? 0) <= 0}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition disabled:bg-slate-100 disabled:cursor-not-allowed"
                  >
                    <option value="amazon">Amazon</option>
                    <option value="shopify" disabled>Shopify (Coming Soon)</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !authenticated || (user?.credits_remaining ?? 0) <= 0}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-3 px-6 rounded-lg transition duration-200 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Generating...
                  </>
                ) : (user?.credits_remaining ?? 0) <= 0 ? (
                  "Out of Credits"
                ) : (
                  <>✨ Generate Listing</>
                )}
              </button>
            </form>

            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                {error}
              </div>
            )}
          </div>

          {/* Output */}
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-slate-800">Generated Content</h2>
              {result && (
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      try {
                        await exportToPDF(result.title, result.bulletPoints, result.description, formData.productName);
                      } catch (err) {
                        console.error('PDF export failed:', err);
                        alert('PDF export failed. Please try again.');
                      }
                    }}
                    className="text-sm bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-lg transition flex items-center gap-1"
                  >
                    📄 PDF
                  </button>
                  <button
                    onClick={() => exportToCSV(result.title, result.bulletPoints, result.description, formData.productName, formData.brandName)}
                    className="text-sm bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-lg transition flex items-center gap-1"
                  >
                    📊 CSV
                  </button>
                  <button
                    onClick={copyAll}
                    className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition"
                  >
                    {copied === "all" ? "✓ Copied!" : "Copy All"}
                  </button>
                </div>
              )}
            </div>

            {!result && !loading && (
              <div className="h-full flex items-center justify-center text-slate-400">
                <div className="text-center">
                  <div className="text-4xl mb-2">📝</div>
                  <p>Fill in the form and click generate</p>
                </div>
              </div>
            )}

            {loading && (
              <div className="h-full flex items-center justify-center text-slate-400">
                <div className="text-center">
                  <svg className="animate-spin h-8 w-8 mx-auto mb-2 text-blue-600" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <p>AI is writing your listing...</p>
                </div>
              </div>
            )}

            {result && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-slate-700">Product Title</h3>
                    <button
                      onClick={() => copyToClipboard(result.title, "title")}
                      className="text-xs text-blue-600 hover:text-blue-700"
                    >
                      {copied === "title" ? "✓ Copied" : "Copy"}
                    </button>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg text-sm text-slate-800 leading-relaxed">
                    {result.title}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-slate-700">Bullet Points</h3>
                    <button
                      onClick={() => copyToClipboard(result.bulletPoints.join("\n"), "bullets")}
                      className="text-xs text-blue-600 hover:text-blue-700"
                    >
                      {copied === "bullets" ? "✓ Copied" : "Copy"}
                    </button>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg space-y-2">
                    {result.bulletPoints.map((point, index) => (
                      <div key={index} className="flex gap-2 text-sm text-slate-800">
                        <span className="text-blue-600 font-bold">•</span>
                        <span>{point}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-slate-700">Product Description</h3>
                    <button
                      onClick={() => copyToClipboard(result.description, "description")}
                      className="text-xs text-blue-600 hover:text-blue-700"
                    >
                      {copied === "description" ? "✓ Copied" : "Copy"}
                    </button>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg text-sm text-slate-800 whitespace-pre-line leading-relaxed">
                    {result.description}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-12 text-center text-sm text-slate-500">
          <p>Register and get 3 free generations · Upgrade Pro Unlock More</p>
        </div>
      </div>
    </div>
  );
}
