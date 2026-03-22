"use client";

import { useState, useEffect } from "react";

interface User {
  id: string;
  email: string;
  name: string;
  picture: string;
  subscription_status: string;
  subscription_plan: string | null;
}

interface GenerateResult {
  title: string;
  bulletPoints: string[];
  description: string;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  
  const [formData, setFormData] = useState({
    productName: "",
    brandName: "",
    features: "",
    audience: "",
    keywords: "",
    tone: "persuasive",
    platform: "amazon",
  });

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  // 检查登录状态
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const res = await fetch("/api/auth/me");
      const data = await res.json();
      setAuthenticated(data.authenticated);
      setUser(data.user);
    } catch (err) {
      console.error("Auth check failed:", err);
    } finally {
      setCheckingAuth(false);
    }
  };

  const handleLogin = () => {
    window.location.href = "/api/auth/google";
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setAuthenticated(false);
      setUser(null);
      window.location.reload();
    } catch (err) {
      console.error("Logout failed:", err);
    }
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
      console.log("Submitting form data:", formData);
      
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      console.log("Response status:", response.status);
      
      const data = await response.json();
      console.log("Response data:", data);

      if (!response.ok) {
        throw new Error(data.error || `Failed to generate (${response.status})`);
      }

      if (!data.data) {
        throw new Error("No data returned from API");
      }

      setResult(data.data);
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

  // 检查登录状态时显示 loading
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
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-sm font-medium text-slate-700">{user.name || user.email}</p>
                    <p className="text-xs text-slate-500">
                      {user.subscription_status === "free" ? "Free Tier" : user.subscription_plan}
                    </p>
                  </div>
                  {user.picture && (
                    <img 
                      src={user.picture} 
                      alt={user.name}
                      className="w-10 h-10 rounded-full"
                    />
                  )}
                  <button
                    onClick={handleLogout}
                    className="text-sm bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1.5 rounded-lg transition"
                  >
                    Logout
                  </button>
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
          {!authenticated && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
              Please sign in to use the generator
            </div>
          )}
        </div>

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
                  disabled={!authenticated}
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
                  disabled={!authenticated}
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
                  disabled={!authenticated}
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
                  disabled={!authenticated}
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
                  disabled={!authenticated}
                  placeholder="ice silk underwear, mens underwear"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition disabled:bg-slate-100 disabled:cursor-not-allowed"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Tone
                  </label>
                  <select
                    name="tone"
                    value={formData.tone}
                    onChange={handleChange}
                    disabled={!authenticated}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition disabled:bg-slate-100 disabled:cursor-not-allowed"
                  >
                    <option value="professional">Professional</option>
                    <option value="persuasive">Persuasive</option>
                    <option value="friendly">Friendly</option>
                    <option value="luxury">Luxury</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Platform
                  </label>
                  <select
                    name="platform"
                    value={formData.platform}
                    onChange={handleChange}
                    disabled={!authenticated}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition disabled:bg-slate-100 disabled:cursor-not-allowed"
                  >
                    <option value="amazon">Amazon</option>
                    <option value="shopify" disabled>Shopify (Coming Soon)</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !authenticated}
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
                <button
                  onClick={copyAll}
                  className="text-sm bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition"
                >
                  {copied === "all" ? "✓ Copied!" : "Copy All"}
                </button>
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
                {/* Title */}
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

                {/* Bullet Points */}
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

                {/* Description */}
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
          <p>Free tier: 10 generations per day</p>
        </div>
      </div>
    </div>
  );
}
