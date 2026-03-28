"use client";

import { useState, useEffect, useCallback } from "react";
import { exportToPDF, exportToCSV } from "../utils/export";

const WORKER_URL = "https://ai-product-content-generator-api.deforde159.workers.dev";

const PLAN_NAMES: Record<string, string> = {
  free: "Free",
  starter: "Starter",
  pro: "Pro",
  business: "Business",
};

const PLAN_COLORS: Record<string, string> = {
  free: "bg-slate-100 text-slate-700",
  starter: "bg-blue-100 text-blue-700",
  pro: "bg-purple-100 text-purple-700",
  business: "bg-amber-100 text-amber-700",
};

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
  created_at?: string;
}

interface GenerationRecord {
  id: string;
  created_at: string;
  product_name: string;
  brand_name: string;
  features?: string;
  audience?: string;
  tone?: string;
  platform?: string;
  category?: string;
  style?: string;
  generated_title?: string;
  generated_bullets?: string;
  generated_description?: string;
  credits_used: number;
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function Profile() {
  const [user, setUser] = useState<User | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<GenerationRecord[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<GenerationRecord | null>(null);

  const fetchUserData = useCallback(async (token: string) => {
    try {
      const res = await fetch(`${WORKER_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.authenticated) {
        setUser(data.user);
        localStorage.setItem("auth_user", JSON.stringify(data.user));
      }
    } catch (err) {
      console.error("Failed to fetch user data:", err);
    }
  }, []);

  const fetchHistory = useCallback(async (token: string, page = 1) => {
    try {
      const res = await fetch(`${WORKER_URL}/auth/me?history=true&page=${page}&limit=10`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.generations) {
        if (page === 1) {
          setHistory(data.generations);
        } else {
          setHistory((prev) => [...prev, ...data.generations]);
        }
        setHasMoreHistory(data.generations.length === 10);
        setHistoryPage(page);
      }
    } catch (err) {
      console.error("Failed to fetch history:", err);
    }
  }, []);

  useEffect(() => {
    const initAuth = () => {
      const storedUser = localStorage.getItem("auth_user");
      const token = localStorage.getItem("auth_token");

      if (storedUser && token) {
        try {
          const parsedUser = JSON.parse(storedUser);
          setUser(parsedUser);
          setAuthenticated(true);
          // Fetch fresh data from API
          fetchUserData(token);
          fetchHistory(token, 1);
        } catch {
          localStorage.removeItem("auth_user");
          localStorage.removeItem("auth_token");
        }
      }
      setLoading(false);
    };

    initAuth();
  }, [fetchUserData, fetchHistory]);

  // Check for upgrade modal trigger (separate effect to avoid cascading renders)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("upgrade") === "true") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowUpgradeModal(true);
      window.history.replaceState({}, "", "/profile");
    }
  }, []);

  // 处理 PayPal 订阅返回
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const subscriptionReturn = params.get("subscription_return");
    const subscriptionCancel = params.get("subscription_cancel");
    const planKey = params.get("plan");
    const subscriptionId = params.get("subscription_id");

    if (subscriptionCancel === "1") {
      window.history.replaceState({}, "", "/profile");
      setShowUpgradeModal(false);
      return;
    }

    if (subscriptionReturn === "1" && planKey && subscriptionId) {
      (async () => {
        try {
          const captureRes = await fetch(`${WORKER_URL}/api/paypal/capture-subscription`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...getAuthHeaders(),
            },
            body: JSON.stringify({ subscriptionId, plan_key: planKey }),
          });

          const captureData = await captureRes.json();

          if (!captureRes.ok) {
            alert("订阅激活失败: " + (captureData.error || "未知错误"));
            window.history.replaceState({}, "", "/profile");
            setShowUpgradeModal(false);
            return;
          }

          // 更新用户信息
          if (user) {
            const updatedUser = {
              ...user,
              subscription_plan: captureData.plan,
              monthly_credits: captureData.monthly_credits,
              monthly_remaining: captureData.monthly_remaining,
              credits_remaining: captureData.credits_remaining,
            };
            setUser(updatedUser);
            localStorage.setItem("auth_user", JSON.stringify(updatedUser));
          }

          alert("订阅成功！您已升级到 " + planKey.toUpperCase() + " 方案");
          window.history.replaceState({}, "", "/profile");
          setShowUpgradeModal(false);

          // 刷新用户数据
          const token = localStorage.getItem("auth_token");
          if (token) fetchUserData(token);

        } catch (err) {
          alert("订阅激活失败: " + (err instanceof Error ? err.message : "未知错误"));
          window.history.replaceState({}, "", "/profile");
          setShowUpgradeModal(false);
        }
      })();
    }
  }, [user, fetchUserData]);

  const handleUpgradePlan = async (planKey: string) => {
    if (!authenticated || !user) return;

    try {
      const res = await fetch(`${WORKER_URL}/api/paypal/create-subscription`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ plan_key: planKey }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert("订阅创建失败: " + (data.error || "未知错误"));
        return;
      }

      // 跳转到 PayPal 订阅授权页面
      // eslint-disable-next-line react-hooks/immutability
      window.location.href = data.approvalUrl;

    } catch (err) {
      alert("订阅创建失败: " + (err instanceof Error ? err.message : "未知错误"));
    }
  };

  const handleLogin = () => {
    const frontendUrl = window.location.origin;
    const popup = window.open(
      `${WORKER_URL}/auth/google?frontend_url=${encodeURIComponent(frontendUrl)}`,
      "google_login",
      "width=500,height=600,scrollbars=yes"
    );
    // Listen for login success
    const timer = setInterval(() => {
      if (popup?.closed) {
        clearInterval(timer);
        const token = localStorage.getItem("auth_token");
        const storedUser = localStorage.getItem("auth_user");
        if (token && storedUser) {
          setAuthenticated(true);
          setUser(JSON.parse(storedUser));
          fetchUserData(token);
          fetchHistory(token, 1);
        }
      }
    }, 500);
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
    setHistory([]);
  };

  const loadMoreHistory = () => {
    const token = localStorage.getItem("auth_token");
    if (token && hasMoreHistory) {
      fetchHistory(token, historyPage + 1);
    }
  };

  const creditPercent = () => {
    if (!user) return 0;
    const total = user.monthly_credits + user.package_remaining;
    if (total === 0) return 0;
    return Math.round((user.credits_remaining / total) * 100);
  };

  const formatDate = (dateStr: string | number) => {
    // Handle Unix timestamp (seconds or milliseconds)
    const ts = typeof dateStr === "string" ? parseInt(dateStr) : dateStr;
    // If it looks like seconds (before year 3000 in seconds), convert to ms
    const ms = ts < 10000000000 ? ts * 1000 : ts;
    const date = new Date(ms);
    return date.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Helper to parse bullet points from JSON string
  const getBullets = (bulletsStr: string | undefined): string[] => {
    if (!bulletsStr) return [];
    try {
      return JSON.parse(bulletsStr);
    } catch {
      return [];
    }
  };

  const formatTitleDate = (dateStr: string | number) => {
    const ts = typeof dateStr === "string" ? parseInt(dateStr) : dateStr;
    const ms = ts < 10000000000 ? ts * 1000 : ts;
    const date = new Date(ms);
    return date.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).replace(/\//g, "-");
  };

  if (loading) {
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

  if (!authenticated || !user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full mx-4 text-center">
          <div className="text-5xl mb-4">👤</div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">个人中心</h1>
          <p className="text-slate-600 mb-6">登录后查看您的账户信息和使用记录</p>
          <button
            onClick={handleLogin}
            className="flex items-center justify-center gap-2 w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition mx-auto"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* 升级弹窗 */}
      {showUpgradeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 max-w-2xl w-full mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="text-center mb-6">
              <div className="text-5xl mb-4">⚡</div>
              <h2 className="text-2xl font-bold text-slate-800 mb-2">选择适合您的套餐</h2>
              <p className="text-slate-600">解锁更多积分和高级功能</p>
            </div>

            {/* 套餐对比表 */}
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              {[
                {
                  name: "Free",
                  price: "$0",
                  period: "永久免费",
                  credits: "3",
                  features: ["3 次免费生成", "基础模板", "英文支持", "社区支持"],
                  highlight: false,
                  cta: "当前方案",
                },
                {
                  name: "Starter",
                  price: "$5",
                  period: "/月",
                  credits: "60",
                  features: ["60 积分/月", "所有基础模板", "中英双语", "Email 支持", "最近 7 天历史"],
                  highlight: false,
                  cta: "选择 Starter",
                },
                {
                  name: "Pro",
                  price: "$15",
                  period: "/月",
                  credits: "200",
                  features: ["200 积分/月", "高级模板", "多语言支持（中/英/日/韩）", "优先 Email 支持", "30 天历史记录", "PDF 导出"],
                  highlight: true,
                  cta: "最受欢迎",
                },
                {
                  name: "Business",
                  price: "$39",
                  period: "/月",
                  credits: "600",
                  features: ["600 积分/月", "企业定制模板", "全语言支持", "7×24 优先支持", "90 天历史记录", "PDF/CSV 导出", "API 访问"],
                  highlight: false,
                  cta: "选择 Business",
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
                      推荐
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
                      <span className="font-semibold text-slate-700">{plan.credits} 积分/月</span>
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
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">个人中心</h1>
            <p className="text-slate-600 mt-1">管理您的账户和积分</p>
          </div>
          <button
            onClick={() => window.location.href = "/"}
            className="text-sm bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 px-4 py-2 rounded-lg transition"
          >
            ← 返回首页
          </button>
        </div>

        {/* 用户信息卡片 */}
        <div className="bg-white rounded-2xl shadow-sm p-6 mb-6">
          <div className="flex items-center gap-4">
            {user.picture ? (
              <img src={user.picture} alt={user.name} className="w-16 h-16 rounded-full" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center text-2xl">
                👤
              </div>
            )}
            <div className="flex-1">
              <h2 className="text-xl font-bold text-slate-800">{user.name || "User"}</h2>
              <p className="text-slate-500 text-sm">{user.email}</p>
              <div className="flex items-center gap-2 mt-2">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${PLAN_COLORS[user.subscription_plan] || PLAN_COLORS.free}`}>
                  {PLAN_NAMES[user.subscription_plan] || "Free"}
                </span>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  user.subscription_status === "active"
                    ? "bg-green-100 text-green-700"
                    : "bg-slate-100 text-slate-600"
                }`}>
                  {user.subscription_status === "active" ? "✅ 活跃" : "⚠️ 未激活"}
                </span>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="text-sm bg-red-50 hover:bg-red-100 text-red-600 px-4 py-2 rounded-lg transition"
            >
              退出登录
            </button>
          </div>
        </div>

        {/* 积分信息 */}
        <div className="grid md:grid-cols-3 gap-4 mb-6">
          {/* 总积分 */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center text-xl">💰</div>
              <div>
                <p className="text-sm text-slate-500">总剩余积分</p>
                <p className="text-2xl font-bold text-blue-600">{user.credits_remaining}</p>
              </div>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all"
                style={{ width: `${creditPercent()}%` }}
              />
            </div>
            <p className="text-xs text-slate-400 mt-2">使用率 {creditPercent()}%</p>
          </div>

          {/* 月度积分 */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center text-xl">📅</div>
              <div>
                <p className="text-sm text-slate-500">本月额度</p>
                <p className="text-2xl font-bold text-purple-600">{user.monthly_remaining}</p>
              </div>
            </div>
            <p className="text-sm text-slate-500">
              已用 <span className="font-medium text-slate-700">{user.monthly_used}</span> /{" "}
              <span className="font-medium text-slate-700">{user.monthly_credits}</span>
            </p>
            <p className="text-xs text-slate-400 mt-1">每月重置</p>
          </div>

          {/* 积分包 */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center text-xl">📦</div>
              <div>
                <p className="text-sm text-slate-500">积分包剩余</p>
                <p className="text-2xl font-bold text-green-600">{user.package_remaining}</p>
              </div>
            </div>
            <p className="text-sm text-slate-500">购买积分包获取更多额度</p>
            <button
              onClick={() => window.location.href = "/?upgrade=true"}
              className="text-xs text-green-600 hover:text-green-700 font-medium mt-1"
            >
              购买积分 →
            </button>
          </div>
        </div>

        {/* 套餐信息 */}
        <div className="bg-white rounded-2xl shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-800">套餐信息</h3>
            <button
              onClick={() => setShowUpgradeModal(true)}
              className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition"
            >
              升级套餐
            </button>
          </div>
          <div className="grid md:grid-cols-4 gap-4">
            <div className="bg-slate-50 rounded-lg p-4">
              <p className="text-sm text-slate-500 mb-1">当前套餐</p>
              <p className="font-bold text-slate-800">{PLAN_NAMES[user.subscription_plan] || "Free"}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-4">
              <p className="text-sm text-slate-500 mb-1">套餐状态</p>
              <p className="font-bold text-slate-800">{user.subscription_status === "active" ? "活跃" : "未激活"}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-4">
              <p className="text-sm text-slate-500 mb-1">月度额度</p>
              <p className="font-bold text-slate-800">{user.monthly_credits} 次</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-4">
              <p className="text-sm text-slate-500 mb-1">注册时间</p>
              <p className="font-bold text-slate-800 text-sm">
                {user.created_at ? formatDate(user.created_at).split(" ")[0] : "-"}
              </p>
            </div>
          </div>
        </div>

        {/* 使用记录 */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">使用记录</h3>

          {history.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <div className="text-4xl mb-2">📭</div>
              <p>暂无使用记录</p>
              <button
                onClick={() => window.location.href = "/"}
                className="mt-4 text-blue-600 hover:text-blue-700 text-sm font-medium"
              >
                去生成内容 →
              </button>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {history.map((record) => (
                  <div
                    key={record.id}
                    onClick={() => setSelectedRecord(record)}
                    className="flex items-center justify-between p-4 bg-slate-50 rounded-lg hover:bg-slate-100 cursor-pointer transition"
                  >
                    <div className="flex-1">
                      <p className="font-medium text-slate-800">
                        {formatTitleDate(record.created_at)} / {record.product_name}
                      </p>
                      <p className="text-sm text-slate-500">{formatDate(record.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                        -{record.credits_used} 积分
                      </span>
                      <span className="text-blue-500">查看 →</span>
                    </div>
                  </div>
                ))}
              </div>

              {hasMoreHistory && (
                <div className="mt-4 text-center">
                  <button
                    onClick={loadMoreHistory}
                    className="text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 px-6 py-2 rounded-lg transition"
                  >
                    加载更多
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* 记录详情弹窗 */}
        {selectedRecord && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSelectedRecord(null)}>
            <div className="bg-white rounded-2xl p-6 max-w-2xl w-full mx-4 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-slate-800">生成详情</h3>
                <div className="flex items-center gap-2">
                  {selectedRecord.generated_title && (
                    <>
                      <button
                        onClick={async () => {
                          try {
                            const bullets = getBullets(selectedRecord.generated_bullets);
                            await exportToPDF(selectedRecord.generated_title || "", bullets, selectedRecord.generated_description || "", selectedRecord.product_name);
                          } catch (err) {
                            console.error('PDF export failed:', err);
                            alert('PDF export failed. Please try again.');
                          }
                        }}
                        className="text-sm bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg transition flex items-center gap-1"
                      >
                        📄 PDF
                      </button>
                      <button
                        onClick={() => {
                          const bullets = getBullets(selectedRecord.generated_bullets);
                          exportToCSV(selectedRecord.generated_title || "", bullets, selectedRecord.generated_description || "", selectedRecord.product_name, selectedRecord.brand_name || "");
                        }}
                        className="text-sm bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg transition flex items-center gap-1"
                      >
                        📊 CSV
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setSelectedRecord(null)}
                    className="text-slate-400 hover:text-slate-600 text-2xl"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                {/* 输入信息 */}
                <div className="bg-slate-50 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-slate-500 mb-2">📝 输入信息</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <p><span className="text-slate-500">产品：</span>{selectedRecord.product_name}</p>
                    {selectedRecord.brand_name && <p><span className="text-slate-500">品牌：</span>{selectedRecord.brand_name}</p>}
                    {selectedRecord.features && <p className="col-span-2"><span className="text-slate-500">特性：</span>{selectedRecord.features}</p>}
                    {selectedRecord.audience && <p><span className="text-slate-500">受众：</span>{selectedRecord.audience}</p>}
                    {selectedRecord.tone && <p><span className="text-slate-500">语气：</span>{selectedRecord.tone}</p>}
                    {selectedRecord.platform && <p><span className="text-slate-500">平台：</span>{selectedRecord.platform}</p>}
                    {selectedRecord.category && <p><span className="text-slate-500">分类：</span>{selectedRecord.category}</p>}
                    {selectedRecord.style && <p><span className="text-slate-500">风格：</span>{selectedRecord.style}</p>}
                  </div>
                </div>

                {/* 生成的标题 */}
                {selectedRecord.generated_title && (
                  <div>
                    <h4 className="text-sm font-medium text-slate-500 mb-2">✨ 标题</h4>
                    <div className="p-3 bg-blue-50 rounded-lg text-sm text-slate-800">
                      {selectedRecord.generated_title}
                    </div>
                  </div>
                )}

                {/* 生成的要点 */}
                {selectedRecord.generated_bullets && (
                  <div>
                    <h4 className="text-sm font-medium text-slate-500 mb-2">📋 要点</h4>
                    <div className="p-3 bg-blue-50 rounded-lg space-y-2">
                      {(() => {
                        try {
                          const bullets = JSON.parse(selectedRecord.generated_bullets || "[]");
                          return bullets.map((b: string, i: number) => (
                            <div key={i} className="flex gap-2 text-sm text-slate-800">
                              <span className="text-blue-600">•</span>
                              <span>{b}</span>
                            </div>
                          ));
                        } catch {
                          return <p>{selectedRecord.generated_bullets}</p>;
                        }
                      })()}
                    </div>
                  </div>
                )}

                {/* 生成的描述 */}
                {selectedRecord.generated_description && (
                  <div>
                    <h4 className="text-sm font-medium text-slate-500 mb-2">📄 描述</h4>
                    <div className="p-3 bg-blue-50 rounded-lg text-sm text-slate-800 whitespace-pre-line">
                      {selectedRecord.generated_description}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-slate-200 text-center text-xs text-slate-400">
                生成时间：{formatDate(selectedRecord.created_at)} · 消耗 {selectedRecord.credits_used} 积分
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-slate-500">
          <p>AI Product Content Generator · 个人中心</p>
        </div>
      </div>
    </div>
  );
}
