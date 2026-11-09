export function GET() {
    return new Response(
        `User-agent: *
Allow: /

Sitemap: ${new URL("/sitemap.xml", import.meta.env.SITE)}
`,
        {
            headers: {
                "Content-Type": "text/plain; charset=utf-8",
            },
        },
    );
}
