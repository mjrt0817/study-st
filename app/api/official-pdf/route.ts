const IPA_PDF_URL = "https://www.ipa.go.jp/shiken/mondai-kaiotu/nl10bi0000009lh8-att/2025r07h_koudo_am1_qs.pdf";

function copyHeader(source: Headers, target: Headers, name: string) {
  const value = source.get(name);
  if (value) target.set(name, value);
}

export async function GET(request: Request) {
  const range = request.headers.get("range");
  const upstreamHeaders = new Headers();
  if (range) upstreamHeaders.set("range", range);

  try {
    const upstream = await fetch(IPA_PDF_URL, {
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
    headers.set("content-disposition", 'inline; filename="ipa-2025-a1.pdf"');
    headers.set("x-content-type-options", "nosniff");
    headers.set("cache-control", range
      ? "private, no-store"
      : "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800");

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    console.error("official-pdf proxy error", error);
    return new Response("IPA公式PDFの取得に失敗しました。上部の『PDFを別タブで開く』を利用してください。", {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
