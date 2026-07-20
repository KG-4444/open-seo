import { describe, expect, it } from "vitest";
import { toGoogleAdsLanguageCode } from "./google-ads";

describe("toGoogleAdsLanguageCode", () => {
  it("translates canonical Chinese locale codes at the Google Ads boundary", () => {
    expect(toGoogleAdsLanguageCode("zh-TW")).toBe("zh_TW");
    expect(toGoogleAdsLanguageCode("zh-CN")).toBe("zh_CN");
  });

  it("preserves Google Ads language codes that do not need translation", () => {
    expect(toGoogleAdsLanguageCode("en")).toBe("en");
    expect(toGoogleAdsLanguageCode("is")).toBe("is");
  });
});
