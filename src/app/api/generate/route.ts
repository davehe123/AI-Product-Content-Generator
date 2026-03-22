import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

interface GenerateRequest {
  productName: string;
  brandName: string;
  features: string;
  audience: string;
  keywords: string;
  tone: string;
  platform: string;
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "DEEPSEEK_API_KEY is not set" },
        { status: 500 }
      );
    }

    const body: GenerateRequest = await request.json();
    const { productName, brandName, features, audience, keywords, tone, platform } = body;

    if (!productName || !features) {
      return NextResponse.json(
        { error: "Product name and features are required" },
        { status: 400 }
      );
    }

    const prompt = `You are an expert eCommerce copywriter specializing in ${platform === 'amazon' ? 'Amazon' : 'Shopify'} product listings.

Generate a high-converting product listing with:

## 1. Product Title (150-200 characters)
- Format: Brand + Core Keywords + Product Type + Features + Quantity
- Include core keywords for SEO
- Conversion-focused wording

## 2. Five Bullet Points
Each bullet should include:
- Product feature
- User benefit
- Emotional appeal
- Use case

## 3. Product Description (2-3 paragraphs)
- Sales-driven language
- Clear Call-to-Action
- Natural keyword integration

Requirements:
- High conversion focus
- Highlight user benefits, not just features
- Native English expression
- Natural keyword placement
- Follow ${platform === 'amazon' ? 'Amazon' : 'Shopify'} SEO best practices

Input:
Product: ${productName}
Brand: ${brandName || 'N/A'}
Features: ${features}
Target Audience: ${audience || 'General'}
Core Keywords: ${keywords || 'N/A'}
Tone: ${tone}

Please output in the following JSON format:
{
  "title": "...",
  "bulletPoints": ["...", "...", "...", "...", "..."],
  "description": "..."
}`;

    // Use DeepSeek API (OpenAI-compatible)
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: "You are an expert Amazon product listing copywriter. Generate high-converting, SEO-optimized content."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || "DeepSeek API error");
    }

    const data = await response.json();
    const responseContent = data.choices[0]?.message?.content;

    if (!responseContent) {
      throw new Error("No response from AI");
    }

    const parsedResult = JSON.parse(responseContent);

    // Ensure we have exactly 5 bullet points
    const bulletPoints = Array.isArray(parsedResult.bulletPoints) 
      ? parsedResult.bulletPoints.slice(0, 5) 
      : [];

    return NextResponse.json({
      success: true,
      data: {
        title: parsedResult.title,
        bulletPoints,
        description: parsedResult.description
      }
    });

  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate content" },
      { status: 500 }
    );
  }
}
