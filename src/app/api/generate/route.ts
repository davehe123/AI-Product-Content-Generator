import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  return new OpenAI({ apiKey });
}

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

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
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
    });

    const responseContent = completion.choices[0]?.message?.content;

    if (!responseContent) {
      throw new Error("No response from AI");
    }

    const parsedResult = JSON.parse(responseContent);

    // Validate the response structure
    if (!parsedResult.title || !parsedResult.bulletPoints || !parsedResult.description) {
      throw new Error("Invalid response format from AI");
    }

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
    console.error("Generation error:", error);

    if (error instanceof OpenAI.APIError) {
      if (error.status === 401) {
        return NextResponse.json(
          { error: "Invalid API key. Please check your OpenAI API key." },
          { status: 401 }
        );
      }
      if (error.status === 429) {
        return NextResponse.json(
          { error: "Rate limit exceeded. Please try again later." },
          { status: 429 }
        );
      }
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate content" },
      { status: 500 }
    );
  }
}
