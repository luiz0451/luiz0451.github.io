export type VideoEmbed =
    | { kind: "iframe"; src: string; provider: "youtube"; thumbnail: string }
    | { kind: "iframe"; src: string; provider: "vimeo"; pageUrl: string }
    | { kind: "file"; src: string };

const youtubeId = /^[\w-]{11}$/;
const vimeoId = /^\d+$/;
const fileExtension = /\.(mp4|webm|ogv|mov)$/i;

/** Returns null when the URL is not a supported video source. */
export function parseVideoUrl(input: string): VideoEmbed | null {
    let url: URL;
    try {
        url = new URL(input);
    } catch {
        return null;
    }

    const host = url.hostname.replace(/^(www|m)\./, "");
    const segments = url.pathname.split("/").filter(Boolean);

    if (host === "youtu.be") {
        return youtubeEmbed(segments[0], url);
    }

    if (host === "youtube.com" || host === "youtube-nocookie.com") {
        if (url.pathname === "/watch") {
            return youtubeEmbed(url.searchParams.get("v"), url);
        }
        if (["embed", "shorts", "live", "v"].includes(segments[0] ?? "")) {
            return youtubeEmbed(segments[1], url);
        }
        return null;
    }

    if (host === "vimeo.com" || host === "player.vimeo.com") {
        const id = segments.find((segment) => vimeoId.test(segment));
        return id
            ? { kind: "iframe", provider: "vimeo", src: `https://player.vimeo.com/video/${id}?dnt=1`, pageUrl: `https://vimeo.com/${id}` }
            : null;
    }

    if (fileExtension.test(url.pathname)) {
        return { kind: "file", src: url.href };
    }

    return null;
}

function youtubeEmbed(id: string | null | undefined, url: URL): VideoEmbed | null {
    if (!id || !youtubeId.test(id)) return null;
    const start = Number.parseInt(url.searchParams.get("t") ?? url.searchParams.get("start") ?? "", 10);
    const params = Number.isFinite(start) && start > 0 ? `?start=${start}` : "";
    return {
        kind: "iframe",
        provider: "youtube",
        src: `https://www.youtube-nocookie.com/embed/${id}${params}`,
        thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    };
}

/** Still-image URL for a video preview; null when none is available (file videos, Vimeo lookup failure). */
export async function videoThumbnail(video: VideoEmbed): Promise<string | null> {
    if (video.kind === "file") return null;
    if (video.provider === "youtube") return video.thumbnail;

    try {
        const response = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(video.pageUrl)}&width=800`);
        if (!response.ok) return null;
        const { thumbnail_url } = (await response.json()) as { thumbnail_url?: string };
        return thumbnail_url ?? null;
    } catch {
        return null;
    }
}
