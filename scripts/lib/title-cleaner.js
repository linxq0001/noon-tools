const platformWords = [
  "1688",
  "阿里巴巴",
  "淘宝",
  "天猫",
  "拼多多",
  "抖音",
  "快手",
  "跨境",
  "外贸",
  "亚马逊",
  "速卖通",
  "temu",
  "shein",
  "lazada",
  "shopee",
  "tiktok",
];

const marketingWords = [
  "爆款",
  "热销",
  "现货",
  "厂家",
  "批发",
  "直销",
  "供应",
  "源头",
  "包邮",
  "一件代发",
  "新款",
  "网红",
  "同款",
  "推荐",
  "促销",
];

const weakStyleWords = ["高级感", "轻奢", "时尚", "百搭", "个性", "创意"];

const bagTypes = [
  { label: "晚宴包", patterns: ["晚宴包", "礼服包", "派对包", "evening bag", "evening clutch"] },
  { label: "手拿包", patterns: ["手拿包", "手抓包", "clutch bag", "clutch"] },
  { label: "手抓包", patterns: ["手抓包"] },
  { label: "链条包", patterns: ["链条包"] },
  { label: "单肩包", patterns: ["单肩包", "shoulder bag"] },
  { label: "斜挎包", patterns: ["斜挎包", "crossbody bag"] },
  { label: "盒子包", patterns: ["盒子包", "box bag"] },
  { label: "贝壳包", patterns: ["贝壳包", "shell bag"] },
  { label: "水桶包", patterns: ["水桶包", "bucket bag"] },
  { label: "小方包", patterns: ["小方包", "方包", "square bag"] },
  { label: "钱包", patterns: ["钱包", "wallet"] },
  { label: "化妆包", patterns: ["化妆包", "cosmetic bag"] },
];

export function cleanProductTitle(sourceTitle, attributes = []) {
  const attributeMap = Object.fromEntries(attributes.map((item) => [item.name, item.value]));
  const sourceText = cleanText(sourceTitle);
  const typeSource = [sourceText, attributeMap["箱包潮流款式"], attributeMap["箱包形状"], attributeMap["风格"]].filter(Boolean).join(" ");
  const titleParts = extractTitleParts(typeSource);
  const productTypeText = titleParts.join(" / ");
  const titleCore = stripBagTypes(stripNoisyTitle(sourceText));
  const title = cleanText([titleCore, productTypeText].filter(Boolean).join(" ")).replace(/\s+\/\s+/g, " / ");

  return {
    title: title || productTypeText || firstAttributeValue(attributeMap["箱包潮流款式"]) || "包",
    titleParts,
    productTypeText,
  };
}

export function extractTitleParts(value) {
  const text = cleanText(value).toLowerCase();
  const found = [];

  for (const type of bagTypes) {
    if (type.patterns.some((pattern) => text.includes(pattern.toLowerCase())) && !found.includes(type.label)) {
      found.push(type.label);
    }
  }

  return found.slice(0, 3);
}

function stripNoisyTitle(value) {
  let text = cleanText(value)
    .replace(/\s*[-_]\s*阿里巴巴.*$/i, "")
    .replace(/^[A-Za-z0-9\s-]+(?=[\u4e00-\u9fa5])/g, "")
    .replace(/(?:适合|用于).+$/g, "");

  for (const word of [...platformWords, ...marketingWords, ...weakStyleWords]) {
    text = text.replace(new RegExp(escapeRegExp(word), "gi"), " ");
  }

  return cleanText(text);
}

function stripBagTypes(value) {
  let text = cleanText(value);

  for (const type of bagTypes) {
    for (const pattern of type.patterns) {
      text = text.replace(new RegExp(escapeRegExp(pattern), "gi"), " ");
    }
  }

  return cleanText(text);
}

function firstAttributeValue(value) {
  return cleanText(value).split(/[,，/、]/).map((item) => item.trim()).filter(Boolean)[0] ?? "";
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/[【】\[\]()（）{}]/g, " ")
    .replace(/[|｜]+/g, " ")
    .replace(/[，,、;；]+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
