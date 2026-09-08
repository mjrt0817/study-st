const IPA_PDF_URLS: Record<string, string> = {
  "a1-2025": "https://www.ipa.go.jp/shiken/mondai-kaiotu/nl10bi0000009lh8-att/2025r07h_koudo_am1_qs.pdf",
  "a1-2024": "https://www.ipa.go.jp/shiken/mondai-kaiotu/m42obm000000afqx-att/2024r06h_koudo_am1_qs.pdf",
  "a1-2023": "https://www.ipa.go.jp/shiken/mondai-kaiotu/ps6vr70000010d6y-att/2023r05h_koudo_am1_qs.pdf",
  "a1-2022": "https://www.ipa.go.jp/shiken/mondai-kaiotu/gmcbt80000009sgk-att/2022r04h_koudo_am1_qs.pdf",
  "a1-2021": "https://www.ipa.go.jp/shiken/mondai-kaiotu/gmcbt8000000d5ru-att/2021r03h_koudo_am1_qs.pdf",
  "a2-2025": "https://www.ipa.go.jp/shiken/mondai-kaiotu/nl10bi0000009lh8-att/2025r07h_st_am2_qs.pdf",
  "a2-2024": "https://www.ipa.go.jp/shiken/mondai-kaiotu/m42obm000000afqx-att/2024r06h_st_am2_qs.pdf",
  "a2-2023": "https://www.ipa.go.jp/shiken/mondai-kaiotu/ps6vr70000010d6y-att/2023r05h_st_am2_qs.pdf",
  "a2-2022": "https://www.ipa.go.jp/shiken/mondai-kaiotu/gmcbt80000009sgk-att/2022r04h_st_am2_qs.pdf",
  "a2-2021": "https://www.ipa.go.jp/shiken/mondai-kaiotu/gmcbt8000000d5ru-att/2021r03h_st_am2_qs.pdf",
};

function copyHeader(source: Headers, target: Headers, name: string) {
  const value = source.get(name);
  if (value) target.set(name, value);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const year = requestUrl.searchParams.get("year") || "2025";
  const exam = requestUrl.searchParams.get("exam") === "a2" ? "a2" : "a1";
  const ipaPdfUrl = IPA_PDF_URLS[`${exam}-${year}`];
  if (!ipaPdfUrl) {
    return new Response("指定された年度・科目の公式PDFは登録されていません。", { status: 400 });
  }

  const range = request.headers.get("range");
  const upstreamHeaders = new Headers();
  if (range) upstreamHeaders.set("range", range);

  try {
    const upstream = await fetch(ipaPdfUrl, {
      headers: upstreamHeaders,
      cache: range ? "no-store" : "force-cache",
      ...(range ? {} : { next: { revalidate: 86400 } }),
    });

    if (!upstream.ok && upstream.status !== 206) {
      return new Response("IPA公式PDFの取得に失敗しました。", { status: 502 });
    }

    const headers = new Headers();
    copyHeader(upstream.headers, headers, "content-type");
    copyHeader(upstream.headers, headers, "content-length");
    copyHeader(upstream.headers, headers, "content-range");
    copyHeader(upstream.headers, headers, "accept-ranges");
    copyHeader(upstream.headers, headers, "etag");
    copyHeader(upstream.headers, headers, "last-modified");

    headers.set("content-type", upstream.headers.get("content-type") || "application/pdf");
    headers.set("content-disposition", `inline; filename="ipa-${year}-${exam}.pdf"`);
    headers.set("x-content-type-options", "nosniff");
    headers.set("cache-control", range
      ? "private, no-store"
      : "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800");

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    console.error("official-pdf proxy error", error);
    return new Response("IPA公式PDFの取得に失敗しました。上部の『PDFを別タブで開く』を利用してください。", {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
