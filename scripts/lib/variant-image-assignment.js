const colourAliases = {
  金色: ["金色", "金", "gold", "golden"],
  银色: ["银色", "银", "silver"],
  黑色: ["黑色", "黑", "black"],
  粉色: ["粉色", "粉", "pink", "rose"],
  红色: ["红色", "红", "red"],
  白色: ["白色", "白", "white", "ivory"],
  紫色: ["紫色", "紫", "purple"],
  蓝色: ["蓝色", "蓝", "blue"],
  绿色: ["绿色", "绿", "green"],
  香槟色: ["香槟色", "香槟", "champagne"],
  橘色: ["橘色", "橙色", "orange"],
  彩色: ["彩色", "花色", "multicolour", "multicolor", "colorful"],
};

export function assignImagesToVariants({ colours = [], images = [], visualAssignments = [], minImages = 3, maxImages = 9 } = {}) {
  const sourceColours = colours.length > 0 ? colours : [""];
  const sharedImages = [];
  const byColour = new Map(sourceColours.map((colour) => [colour, []]));
  const assignmentMap = new Map(visualAssignments.map((item) => [item.path || item.image, item.assignedColour]));

  for (const image of images) {
    const assigned = assignmentMap.get(image.path);
    const colour = assigned && assigned !== "_shared" ? matchExistingColour(assigned, sourceColours) : matchImageColour(image, sourceColours);

    if (colour && byColour.has(colour)) {
      byColour.get(colour).push(image);
    } else {
      sharedImages.push(image);
    }
  }

  const result = {};
  const warnings = [];

  for (const colour of sourceColours) {
    const colourImages = dedupeImages([...(byColour.get(colour) ?? []), ...sharedImages]).slice(0, maxImages);

    result[colour || "_default"] = colourImages;
    if (colour && (byColour.get(colour) ?? []).length === 0) warnings.push(`No colour-specific images found for ${colour}.`);
    if (colourImages.length < minImages) warnings.push(`Only ${colourImages.length} image(s) assigned for ${colour || "default variant"}.`);
  }

  return {
    imagesByColour: result,
    sharedImages,
    warnings,
  };
}

export function matchImageColour(image, colours) {
  const text = normalize([image?.sourceUrl, image?.path, image?.alt, image?.nearText].filter(Boolean).join(" "));
  return colours.map((colour) => matchExistingColourInText(colour, text)).find(Boolean) || "";
}

export function matchExistingColour(value, colours) {
  const text = normalize(value);
  return colours.find((colour) => text === normalize(colour) || aliasesForColour(colour).some((alias) => text === normalize(alias))) ?? "";
}

function matchExistingColourInText(colour, text) {
  if (!colour) return "";
  const aliases = aliasesForColour(colour);

  return aliases.some((alias) => text.includes(normalize(alias))) ? colour : "";
}

function aliasesForColour(colour) {
  return [colour, ...(colourAliases[colour] ?? [])];
}

function dedupeImages(images) {
  const seen = new Set();
  const output = [];

  for (const image of images) {
    const key = image.path || image.sourceUrl;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(image);
  }

  return output;
}

function normalize(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}
