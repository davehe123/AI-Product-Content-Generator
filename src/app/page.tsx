"use client";

import { useState } from "react";

interface GenerateResult {
  title: string;
  bulletPoints: string[];
  description: string;
}

export default function Home() {
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <div className="max-w-4xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-slate-900 mb-3">
            AI Product Content Generator
          </h1>
          <p className="text-lg text-slate-600">
            Generate high-converting Amazon listings in seconds
          </p>
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
                  placeholder="Men's Ice Silk Underwear"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
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
                  placeholder="CozyFit"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
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
                  rows={3}
                  placeholder="breathable, cooling, seamless"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition resize-none"
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
                  placeholder="men, athletes"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
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
                  placeholder="ice silk underwear, mens underwear"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
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
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
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
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                  >
                    <option value="amazon">Amazon</option>
                    <option value="shopify" disabled>Shopify (Coming Soon)</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
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
