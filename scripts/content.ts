#!/usr/bin/env bun
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseVideoUrl } from "../src/utils/video-embed";
import cac from "cac";
import prompts, {
    type PromptAnswers,
    type PromptObject,
    type PromptRenderContext,
    type PromptValue,
} from "prompts";


type ContentType = "post" | "update" | "experience" | "gallery";
type Draft = {
    title?: string;
    description?: string;
    tldr?: boolean;
    tags?: string;
    update?: string;
    organization?: string;
    period?: string;
    bullets?: string;
    [key: string]: PromptValue;
};
type Preview = (draft: Draft) => string[];
type CliOptions = {
    help: boolean;
    type: string | undefined;
    title: string | undefined;
    description: string | undefined;
    tags: string | undefined;
    slug: string | undefined;
    open: boolean | undefined;
    strict: boolean;
};
type PromptQuestion = PromptObject;
type PromptContext = PromptRenderContext;
type PostFields = {
    title?: string;
    description?: string;
    descricao?: string;
    tldr?: string;
    date?: string;
    publishDate?: string;
    draft?: string;
    tags?: string;
    [key: string]: string | undefined;
};
type ParsedPost = {
    filePath: string;
    id: string;
    fields: PostFields;
    frontmatter: string;
    body: string;
};
type CheckIssue = {
    level: "error" | "warning";
    message: string;
};

const directories: Record<ContentType, string> = {
    post: "./src/content/posts",
    update: "./src/content/updates",
    experience: "./src/content/experiences",
    gallery: "./src/content/gallery",
};
const aliases: Record<string, ContentType> = {
    post: "post",
    postagem: "post",
    update: "update",
    atualizacao: "update",
    experience: "experience",
    experiencia: "experience",
    gallery: "gallery",
    galeria: "gallery",
    imagem: "gallery",
    video: "gallery",
};

const cli = cac("content");
cli.usage("new [tipo] | status | publish <post> | check");
cli.option(
    "--type <type>",
    "Tipo: post, update, experience ou gallery",
);
cli.option("--title <title>", "Titulo inicial de um post");
cli.option("--description <description>", "Descricao inicial de um post");
cli.option("--tags <tags>", "Tags iniciais separadas por virgula");
cli.option("--slug <slug>", "Slug do arquivo do post");
cli.option("--no-open", "Nao abrir o editor depois de criar um post");
cli.option("--strict", "Tratar avisos do check como erros");
cli.example("content new post");
cli.example("content status");
cli.example("content publish 2026-08-18-meu-post");
cli.example("content check");
cli.help((sections) =>
    sections.map((section) => ({
        ...section,
        body: section.body.replace("Display this message", "Exibir esta ajuda"),
    })),
);

const { options: parsedOptions } = cli.parse();
const rawOptions = parsedOptions as Record<string, unknown>;
const options: CliOptions = {
    help: rawOptions["help"] === true,
    type: typeof rawOptions["type"] === "string" ? rawOptions["type"] : undefined,
    title: typeof rawOptions["title"] === "string" ? rawOptions["title"] : undefined,
    description: typeof rawOptions["description"] === "string" ? rawOptions["description"] : undefined,
    tags: typeof rawOptions["tags"] === "string" ? rawOptions["tags"] : undefined,
    slug: typeof rawOptions["slug"] === "string" ? rawOptions["slug"] : undefined,
    open: typeof rawOptions["open"] === "boolean" ? rawOptions["open"] : undefined,
    strict: rawOptions["strict"] === true,
};

if (options.help) {
    process.exit(0);
}

function today() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function asYaml(value: string) {
    return JSON.stringify(value);
}

function safeSuffix(suffix: string, fallback: string) {
    return suffix
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || fallback;
}

function previewBlock(lines: string[]) {
    return [
        "",
        "  +-- previa",
        ...lines.map((line) => `  | ${line}`),
        "  +--",
    ].join("\n");
}
function toDraft(response: PromptAnswers): Draft {
    const draft: Draft = {};
    for (const [name, value] of Object.entries(response)) {
        if (name === "tldr") {
            if (value !== undefined && typeof value !== "boolean") {
                throw new Error("A resposta de tldr deve ser booleana.");
            }
            if (value !== undefined) {
                draft.tldr = value;
            }
            continue;
        }

        if (value !== undefined && typeof value !== "string") {
            throw new Error(`A resposta de ${name} deve ser texto.`);
        }
        if (value !== undefined) {
            draft[name] = value;
        }
    }
    return draft;
}


async function askWithPreview(
    questions: PromptQuestion[],
    renderPreview: Preview,
): Promise<Draft> {
    const answers: PromptAnswers = {};
    const decoratedQuestions = questions.map((question) => ({
        ...question,
        onRender(this: PromptContext) {
            const draft: Draft = { ...answers, [question.name]: this.value };
            const activeMessage = `\u001b[36m${question.message}\u001b[39m`;
            this.msg = this.done
                ? question.message
                : `${activeMessage}${previewBlock(renderPreview(draft))}`;
        },
    }));

    const response = await prompts(decoratedQuestions, {
        onSubmit(question: PromptQuestion, answer: PromptValue) {
            answers[question.name] = answer;
        },
    });
    return toDraft(response);
}

function nextFilePath(type: ContentType, suffix: string) {
    const safe = safeSuffix(suffix, type);

    if (type === "experience") {
        const largestNumber = readdirSync(directories[type]).reduce((largest, file) => {
            const match = file.match(/^(\d+)-/);
            return Math.max(largest, match ? Number(match[1]) : 0);
        }, 0);

        let number = largestNumber + 1;
        let filePath = "";
        do {
            filePath = `${directories[type]}/${String(number).padStart(2, "0")}-${safe}.md`;
            number += 1;
        } while (existsSync(filePath));
        return filePath;
    }

    const date = today();
    let number = 0;
    let filePath = "";
    do {
        const counter = number === 0 ? "" : `-${number + 1}`;
        filePath = `${directories[type]}/${date}-${safe}${counter}.md`;
        number += 1;
    } while (existsSync(filePath));

    return filePath;
}

function previewPost(draft: Draft) {
    return [
        `title: ${asYaml(String(draft.title ?? ""))}`,
        `description: ${asYaml(String(draft.description ?? ""))}`,
        `tldr: ${draft.tldr === true}`,
        `tags: ${String(draft.tags ?? "") || "[]"}`,
        "draft: true",
    ];
}

function previewUpdate(draft: Draft) {
    return [
        `date: ${today()}`,
        `update: ${asYaml(String(draft.update ?? ""))}`,
        "corpo:",
        String(draft.description ?? ""),
    ];
}
function previewGallery(draft: Draft) {
    return [
        `title: ${asYaml(String(draft.title ?? ""))}`,
        `date: ${today()}`,
        `image: ${String(draft["source"] ?? "")}`,
        `alt: ${asYaml(String(draft["alt"] ?? ""))}`,
        "legenda:",
        String(draft.description ?? ""),
    ];
}

function previewGalleryVideo(draft: Draft) {
    return [
        "type: video",
        `title: ${asYaml(String(draft.title ?? ""))}`,
        `date: ${today()}`,
        `url: ${String(draft["url"] ?? "")}`,
        "legenda:",
        String(draft.description ?? ""),
    ];
}




function previewExperience(draft: Draft) {
    const bullets = String(draft.bullets ?? "")
        .split("\n")
        .map((bullet) => bullet.trim())
        .filter(Boolean);

    return [
        `organization: ${asYaml(String(draft.organization ?? ""))}`,
        `title: ${asYaml(String(draft.title ?? ""))}`,
        `period: ${asYaml(String(draft.period ?? ""))}`,
        "bullets:",
        ...bullets.map((bullet) => `  - ${bullet}`),
    ];
}


async function chooseType(requestedType?: string): Promise<ContentType | undefined> {
    const requested = requestedType ?? String(options.type ?? "").toLowerCase();
    const selected = requested ? aliases[requested] : undefined;

    if (requested) {
        return selected;
    }

    const response = await prompts({
        type: "select",
        name: "type",
        message: "O que voce quer criar?",
        hint: "- Use as setas. Pressione Enter para confirmar.",
        choices: [
            { title: "Post", value: "post" },
            { title: "Atualizacao de vida", value: "update" },
            { title: "Experiencia profissional", value: "experience" },
            { title: "Galeria (imagem ou video)", value: "gallery" },
        ],
    });

    const selectedValue = response["type"];
    return typeof selectedValue === "string"
        ? aliases[selectedValue.toLowerCase()]
        : undefined;
}

function openEditor(filePath: string) {
    if (options.open === false) {
        return;
    }

    const editor = process.env["VISUAL"]?.trim() ||
        process.env["EDITOR"]?.trim() ||
        (process.platform === "darwin" ? "open -t" : undefined);
    if (!editor) {
        console.log(`Edite o arquivo: ${filePath}`);
        return;
    }

    const result = Bun.spawnSync({
        cmd: ["sh", "-c", `${editor} "$1"`, "content-editor", filePath],
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    });

    if (result.exitCode !== 0) {
        throw new Error(`O editor terminou com codigo ${result.exitCode}.`);
    }
}

async function createPost() {
    const response = await askWithPreview([
        {
            type: "text",
            name: "title",
            message: "Titulo",
            initial: options.title ?? "",
            validate: (value: string) => value.trim() ? true : "Informe um titulo.",
        },
        {
            type: "text",
            name: "description",
            message: "Descricao curta (opcional)",
            initial: options.description ?? "",
        },
        {
            type: "text",
            name: "tags",
            message: "Tags separadas por virgula (opcional)",
            initial: options.tags ?? "",
        },
        {
            type: "confirm",
            name: "tldr",
            message: "Mostrar tl;dr?",
            initial: false,
        },
    ], previewPost);

    const title = String(response.title ?? "").trim();
    if (!title) return;

    const tags = String(response.tags ?? "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
    const date = today();
    const lines = [
        "---",
        `title: ${asYaml(title)}`,
        ...(response.description ? [`description: ${asYaml(String(response.description).trim())}`] : []),
        `tldr: ${response.tldr === true}`,
        `date: ${date}`,
        `publishDate: ${date}`,
        "draft: true",
        ...(tags.length > 0 ? [`tags: [${tags.map(asYaml).join(", ")}]`] : []),
        "---",
        "",
    ];

    const filePath = nextFilePath("post", options.slug || title);
    await Bun.write(filePath, lines.join("\n"));
    console.log(`Rascunho criado: ${filePath}`);
    openEditor(filePath);
}

async function createUpdate() {
    const response = await askWithPreview([
        { type: "text", name: "update", message: "Atualizacao" },
        { type: "text", name: "description", message: "Corpo da atualizacao (opcional)" },
    ], previewUpdate);

    if (!response.update) return;

    const filePath = nextFilePath("update", String(response.update));
    await Bun.write(filePath, [
        "---",
        `date: ${today()}`,
        `update: ${asYaml(String(response.update))}`,
        "---",
        "",
        response.description ?? "",
        "",
    ].join("\n"));
    console.log(`Criado: ${filePath}`);
}


function splitBullets(value: string) {
    return String(value ?? "")
        .split("\n")
        .map((bullet) => bullet.trim())
        .filter(Boolean);
}



async function createExperience() {
    const response = await askWithPreview([
        { type: "text", name: "organization", message: "Organizacao" },
        { type: "text", name: "title", message: "Cargo ou projeto" },
        { type: "text", name: "period", message: "Periodo" },
        {
            type: "text",
            name: "bullets",
            message: "Topicos (um por linha)",
        },
    ], previewExperience);
    const bullets = splitBullets(String(response.bullets ?? ""));

    if (!response.organization || !response.title || !response.period || bullets.length === 0) return;

    const lines = [
        "---",
        `title: ${asYaml(String(response.title))}`,
        `organization: ${asYaml(String(response.organization))}`,
        `period: ${asYaml(String(response.period))}`,
        "bullets:",
        ...bullets.map((bullet) => `    - ${asYaml(bullet)}`),
        "---",
        "",
    ];
    const filePath = nextFilePath("experience", String(response.organization));
    await Bun.write(filePath, lines.join("\n"));
    console.log(`Criado: ${filePath}`);
}

function expandPath(input: string) {
    const unquoted = input.trim().replace(/^(['"])(.*)\1$/, "$2").replace(/\\(.)/g, "$1");
    return unquoted.startsWith("~/")
        ? join(process.env["HOME"] ?? "", unquoted.slice(2))
        : resolve(unquoted);
}

async function createGallery() {
    const kind = await prompts({
        type: "select",
        name: "kind",
        message: "Tipo de midia",
        choices: [
            { title: "Imagem", value: "image" },
            { title: "Video (YouTube, Vimeo ou arquivo)", value: "video" },
        ],
    });
    if (kind["kind"] === "video") {
        await createGalleryVideo();
    } else if (kind["kind"] === "image") {
        await createGalleryImage();
    }
}

async function createGalleryVideo() {
    const response = await askWithPreview([
        { type: "text", name: "title", message: "Titulo" },
        {
            type: "text",
            name: "url",
            message: "URL do video",
            validate: (value: string) =>
                parseVideoUrl(value.trim()) ? true : "Use YouTube, Vimeo ou um link direto .mp4/.webm/.ogv/.mov",
        },
        { type: "text", name: "description", message: "Legenda (opcional)" },
    ], previewGalleryVideo);

    if (!response.title || !response["url"]) return;

    const filePath = nextFilePath("gallery", String(response.title));
    mkdirSync(directories.gallery, { recursive: true });
    await Bun.write(filePath, [
        "---",
        "type: video",
        `title: ${asYaml(String(response.title))}`,
        `date: ${today()}`,
        `url: ${asYaml(String(response["url"]).trim())}`,
        "---",
        "",
        response.description ?? "",
        "",
    ].join("\n"));
    console.log(`Criado: ${filePath}`);
}

async function createGalleryImage() {
    const response = await askWithPreview([
        { type: "text", name: "title", message: "Titulo" },
        { type: "text", name: "source", message: "Caminho da imagem" },
        { type: "text", name: "alt", message: "Texto alternativo" },
        { type: "text", name: "description", message: "Legenda (opcional)" },
    ], previewGallery);

    if (!response.title || !response["source"] || !response["alt"]) return;

    const source = expandPath(String(response["source"]));
    if (!existsSync(source)) {
        throw new Error(`Imagem nao encontrada: ${source}`);
    }

    const mdPath = nextFilePath("gallery", String(response.title));
    const imagePath = mdPath.replace(/\.md$/, extname(source).toLowerCase());
    mkdirSync(directories.gallery, { recursive: true });
    copyFileSync(source, imagePath);
    await Bun.write(mdPath, [
        "---",
        `title: ${asYaml(String(response.title))}`,
        `date: ${today()}`,
        `image: ./${basename(imagePath)}`,
        `alt: ${asYaml(String(response["alt"]))}`,
        "---",
        "",
        response.description ?? "",
        "",
    ].join("\n"));
    console.log(`Criado: ${mdPath}`);
    console.log(`Imagem: ${imagePath}`);
}

async function createContent(type: ContentType) {
    if (type === "post") await createPost();
    if (type === "update") await createUpdate();
    if (type === "experience") await createExperience();
    if (type === "gallery") await createGallery();
}

function yamlScalar(value: string | undefined) {
    const scalar = String(value ?? "").trim();
    if (scalar.startsWith('"') && scalar.endsWith('"')) {
        try {
            return JSON.parse(scalar) as string;
        } catch {
            return scalar.slice(1, -1);
        }
    }
    if (scalar.startsWith("'") && scalar.endsWith("'")) {
        return scalar.slice(1, -1).replace(/''/g, "'");
    }
    return scalar;
}

function parsePost(filePath: string): ParsedPost {
    const content = readFileSync(filePath, "utf8");
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) {
        throw new Error("frontmatter ausente ou invalido");
    }
    const frontmatter = match[1];
    if (frontmatter === undefined) {
        throw new Error("frontmatter ausente ou invalido");
    }

    const fields: PostFields = {};
    for (const line of frontmatter.split(/\r?\n/)) {
        const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
        const key = field?.[1];
        if (key) {
            fields[key] = field[2] ?? "";
        }
    }

    return {
        filePath,
        id: basename(filePath, ".md"),
        fields,
        frontmatter,
        body: content.slice(match[0].length),
    };
}

function postFiles() {
    return readdirSync(directories.post)
        .filter((file) => file.endsWith(".md"))
        .sort()
        .map((file) => join(directories.post, file));
}

function findPost(reference: string) {
    const normalized = reference.trim().replace(/\/+$/, "");
    const fileName = basename(normalized);
    const candidate = fileName.endsWith(".md") ? fileName : `${fileName}.md`;
    const filePath = join(directories.post, candidate);
    return existsSync(filePath) ? filePath : undefined;
}

function validDate(value: string | undefined) {
    if (!value) return false;
    return !Number.isNaN(new Date(yamlScalar(value)).valueOf());
}

function isDraft(post: ParsedPost) {
    return yamlScalar(post.fields.draft) === "true";
}

function localImageIssues(post: ParsedPost): CheckIssue[] {
    const issues: CheckIssue[] = [];
    const imagePattern = /!\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g;
    for (const match of post.body.matchAll(imagePattern)) {
        const rawTarget = match[1];
        if (!rawTarget) continue;
        const target = rawTarget.replace(/^<|>$/g, "").split("#")[0];
        if (!target || target.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
            continue;
        }
        const assetPath = resolve(dirname(post.filePath), target);
        if (!existsSync(assetPath)) {
            issues.push({
                level: "error",
                message: `imagem local nao encontrada: ${target}`,
            });
        }
    }
    return issues;
}

function postIssues(post: ParsedPost): CheckIssue[] {
    const issues: CheckIssue[] = [];
    const title = yamlScalar(post.fields.title);
    const description = yamlScalar(post.fields.description);
    const draft = yamlScalar(post.fields.draft);

    if (!title) {
        issues.push({ level: "error", message: "title ausente ou vazio" });
    }
    if (!validDate(post.fields.date)) {
        issues.push({ level: "error", message: "date ausente ou invalida" });
    }
    if (!validDate(post.fields.publishDate)) {
        issues.push({ level: "error", message: "publishDate ausente ou invalida" });
    }
    if (draft && draft !== "true" && draft !== "false") {
        issues.push({ level: "error", message: "draft deve ser true ou false" });
    }
    if (!post.body.trim()) {
        issues.push({
            level: isDraft(post) ? "warning" : "error",
            message: "corpo vazio",
        });
    }
    if (!description) {
        issues.push({
            level: "warning",
            message: post.fields.descricao !== undefined
                ? "use 'description' em vez de 'descricao'"
                : "description ausente, SEO e RSS ficarao incompletos",
        });
    }
    if (post.fields.publishDate && validDate(post.fields.publishDate)) {
        const publishDate = new Date(yamlScalar(post.fields.publishDate));
        if (!isDraft(post) && publishDate > new Date()) {
            issues.push({
                level: "warning",
                message: "publishDate esta no futuro; o site nao agenda publicacao automaticamente",
            });
        }
    }

    return [...issues, ...localImageIssues(post)];
}

function checkPosts(strict: boolean) {
    const files = postFiles();
    let errors = 0;
    let warnings = 0;

    for (const filePath of files) {
        const id = basename(filePath, ".md");
        let post: ParsedPost;
        try {
            post = parsePost(filePath);
        } catch (error) {
            console.error(`X ${id}: ${error instanceof Error ? error.message : String(error)}`);
            errors += 1;
            continue;
        }

        for (const issue of postIssues(post)) {
            if (issue.level === "error" || strict) {
                console.error(`X ${id}: ${issue.message}`);
                errors += 1;
            } else {
                console.warn(`! ${id}: ${issue.message}`);
                warnings += 1;
            }
        }
    }

    if (errors > 0) {
        console.error(`Check falhou: ${errors} erro(s), ${warnings} aviso(s).`);
        process.exitCode = 1;
        return;
    }

    const suffix = warnings > 0 ? `, ${warnings} aviso(s)` : "";
    console.log(`Check OK: ${files.length} post(s) verificado(s)${suffix}.`);
}

function showStatus() {
    const drafts: ParsedPost[] = [];
    let published = 0;

    for (const filePath of postFiles()) {
        try {
            const post = parsePost(filePath);
            if (isDraft(post)) {
                drafts.push(post);
            } else {
                published += 1;
            }
        } catch {
            console.warn(`! ${basename(filePath)}: frontmatter invalido`);
        }
    }

    drafts.sort((a, b) => {
        const left = new Date(yamlScalar(a.fields.publishDate || a.fields.date)).valueOf();
        const right = new Date(yamlScalar(b.fields.publishDate || b.fields.date)).valueOf();
        return right - left;
    });

    console.log(`Posts: ${published} publicado(s), ${drafts.length} rascunho(s).`);
    if (drafts.length === 0) return;

    for (const draft of drafts) {
        const title = yamlScalar(draft.fields.title) || "(sem titulo)";
        const date = yamlScalar(draft.fields.publishDate || draft.fields.date) || "sem data";
        console.log(`- ${date} | ${title} | ${draft.id}`);
    }
}

function setFrontmatterField(frontmatter: string, key: string, value: string) {
    const lines = frontmatter.split(/\r?\n/);
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^${escapedKey}:`);
    const index = lines.findIndex((line) => pattern.test(line));

    if (index >= 0) {
        lines[index] = `${key}: ${value}`;
        return lines.join("\n");
    }

    const dateIndex = lines.findIndex((line) => /^date:/.test(line));
    lines.splice(dateIndex >= 0 ? dateIndex + 1 : lines.length, 0, `${key}: ${value}`);
    return lines.join("\n");
}

async function publishPost(reference: string | undefined) {
    if (!reference) {
        throw new Error("Uso: bun run content -- publish <post>");
    }

    const filePath = findPost(reference);
    if (!filePath) {
        throw new Error(`Post nao encontrado: ${reference}`);
    }

    const post = parsePost(filePath);
    const issues = postIssues(post);
    const errors = issues.filter((issue) => issue.level === "error");
    for (const issue of issues.filter((issue) => issue.level === "warning")) {
        console.warn(`! ${post.id}: ${issue.message}`);
    }
    if (errors.length > 0) {
        throw new Error(`Post invalido: ${errors.map((issue) => issue.message).join("; ")}`);
    }
    if (!isDraft(post)) {
        console.log(`Post ja publicado: ${post.id}`);
        return;
    }

    let frontmatter = setFrontmatterField(post.frontmatter, "draft", "false");
    frontmatter = setFrontmatterField(frontmatter, "publishDate", today());
    await Bun.write(filePath, `---\n${frontmatter}\n---\n${post.body}`);
    console.log(`Publicado: ${filePath}`);
}

async function main() {
    const args = [...cli.args].map(String);
    const command = (args[0] ?? "").toLowerCase();

    if (command === "status") {
        showStatus();
        return;
    }
    if (command === "check") {
        checkPosts(options.strict === true);
        return;
    }
    if (command === "publish") {
        await publishPost(args[1]);
        return;
    }

    if (command === "new" || command === "create") {
        const type = await chooseType(args[1]);
        if (!type) {
            throw new Error("Escolha um tipo: post, update, experience ou gallery.");
        }
        await createContent(type);
        return;
    }

    const directType = command ? aliases[command] : undefined;
    if (command && !directType && !options.type) {
        throw new Error(`Comando desconhecido: ${command}. Use --help para ver as opcoes.`);
    }

    const type = await chooseType(directType);
    if (!type) {
        throw new Error("Escolha um tipo: post, update, experience ou gallery.");
    }
    await createContent(type);
}

main().catch((error) => {
    console.error(`Erro: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});
