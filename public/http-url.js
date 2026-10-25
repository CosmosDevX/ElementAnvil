export function requestUrl(baseUrl, request) {
  const fail = (message) => Object.assign(new Error(message), { status: 400 });
  const parameters = new Map(
    request.pathParams
      .filter((row) => row.enabled && row.key)
      .map((row) => [row.key, row.value]),
  );
  const expanded = request.path.replace(
    /\{([^{}\/]+)\}|:([A-Za-z_][\w-]*)(?=\/|$|\?)/g,
    (_match, braces, colon) => {
      const key = braces || colon;
      if (!parameters.has(key)) throw fail(`Укажи параметр пути: ${key}`);
      return encodeURIComponent(parameters.get(key));
    },
  );
  let url;
  try {
    url = new URL(expanded, baseUrl || undefined);
  } catch {
    throw fail("Укажи полный URL или базовый адрес и путь");
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw fail("Поддерживаются только HTTP и HTTPS");
  if (url.username || url.password)
    throw fail("Передай авторизацию через заголовок Authorization");
  url.hash = "";
  const query = request.query.filter((row) => row.enabled && row.key);
  if (request.querySeparator === ";") {
    const suffix = new URLSearchParams(query.map((row) => [row.key, row.value]))
      .toString()
      .replaceAll("&", ";");
    if (suffix) url.search += (url.search ? ";" : "?") + suffix;
  } else for (const row of query) url.searchParams.append(row.key, row.value);
  return url;
}
