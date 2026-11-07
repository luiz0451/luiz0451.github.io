import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { glob } from "astro/loaders";
import { glossarySchema } from "./schemas/glossary";
import { parseVideoUrl } from "./utils/video-embed";

const posts = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/posts" }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    tldr: z.boolean().default(false),
    date: z.coerce.date(),
    publishDate: z.coerce.date(),
    draft: z.boolean().default(false),
    tags: z.array(z.string()).optional(),
  }),
});

const updates = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/updates" }),
  schema: z.object({
    date: z.coerce.date(),
    update: z.string(),
    internal: z.boolean().default(false),
  }),
});


const gallery = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/gallery" }),
  schema: ({ image }) => z.object({
    type: z.enum(["image", "video"]).default("image"),
    title: z.string(),
    date: z.coerce.date(),
    image: image().optional(),
    alt: z.string().optional(),
    url: z.url().optional(),
  }).superRefine((data, ctx) => {
    if (data.type === "image") {
      if (!data.image) ctx.addIssue({ code: "custom", path: ["image"], message: "image é obrigatório para type: image" });
      if (!data.alt) ctx.addIssue({ code: "custom", path: ["alt"], message: "alt é obrigatório para type: image" });
    } else if (!data.url || !parseVideoUrl(data.url)) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: "url deve ser YouTube, Vimeo ou um arquivo .mp4/.webm/.ogv/.mov",
      });
    }
  }),
});

const projects = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/projects" }),
  schema: z.object({
    name: z.string(),
    role: z.string(),
    url: z.url().optional(),
    logo: z.string().optional(),
  }),
});

const glossary = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/glossary" }),
  schema: glossarySchema,
});

export const collections = { posts, updates, projects, glossary, gallery };
