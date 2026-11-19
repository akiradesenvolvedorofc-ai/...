<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/* CONFIGURAÇÕES */

$allowedHosts = [
    'www3.dramasfree.com',
    'peliculaplay.com',
    'latino.solo-latino.com',
    'es.cuevana4br.com',
    'flixlat.com',
    'video.playspelis.com',
    'ww1.123flmsfree.com',
    'ver.123pelicula.com',
    'play.cuevana19.com',
    'www3-api.dramasfree.com',
    'test-web-api.dramasfree.com',
    'api.peliculaplay.com',
    'test-web-api.peliculaplay.com',
    'play-api.cuevana19.com',
    'test-web-api.cuevana19.com',
    'ww1-api.123flmsfree.com',
    'test-web-api.123flmsfree.com',
    'api.flixlat.com',
    'test-web-api.flixlat.com',
    'latino-api.solo-latino.com',
    'test-web-api.solo-latino.com',
    'video-api.playspelis.com',
    'test-web-api.playspelis.com',
    'ww20-api.321moviesfree.com',
    'test-web-api.321moviesfree.com',
    'ver-api.123pelicula.com',
    'test-web-api.123pelicula.com'
];

const MAX_SEASON_PAGES = 40;
const REQUEST_TIMEOUT = 20;

/* RESPOSTA JSON */

function output(
    bool $success,
    mixed $data = null,
    ?string $error = null
): never {
    echo json_encode([
        'success' => $success,
        'data' => $data,
        'error' => $error
    ], JSON_UNESCAPED_UNICODE |
       JSON_UNESCAPED_SLASHES |
       JSON_PRETTY_PRINT);

    exit;
}

/* URLS */

function isFullUrl(string $url): bool {
    return filter_var($url, FILTER_VALIDATE_URL) !== false
        && in_array(
            strtolower((string)parse_url($url, PHP_URL_SCHEME)),
            ['http', 'https'],
            true
        );
}

function normalizeUrl(string $url, string $base): string {
    $url = trim(html_entity_decode(
        $url,
        ENT_QUOTES | ENT_HTML5,
        'UTF-8'
    ));

    if ($url === '' || $url === '#') {
        return '';
    }

    if (str_starts_with($url, '//')) {
        return 'https:' . $url;
    }

    if (isFullUrl($url)) {
        return $url;
    }

    $parts = parse_url($base);

    if (empty($parts['host'])) {
        return '';
    }

    $origin = ($parts['scheme'] ?? 'https')
        . '://' . $parts['host'];

    if (str_starts_with($url, '/')) {
        return $origin . $url;
    }

    $directory = rtrim(
        dirname($parts['path'] ?? '/'),
        '/'
    );

    return $origin
        . ($directory !== '' ? $directory . '/' : '/')
        . $url;
}

function validateSourceUrl(string $url): void {
    global $allowedHosts;

    if (!isFullUrl($url)) {
        throw new Exception('URL inválida ou incompleta.');
    }

    $host = strtolower(
        (string)parse_url($url, PHP_URL_HOST)
    );

    if (!in_array($host, $allowedHosts, true)) {
        throw new Exception('Domínio não autorizado: ' . $host);
    }
}

function sameHost(string $a, string $b): bool {
    return strtolower((string)parse_url($a, PHP_URL_HOST))
        === strtolower((string)parse_url($b, PHP_URL_HOST));
}

function canonicalUrl(string $url): string {
    $parts = parse_url($url);

    if (!$parts || empty($parts['host'])) {
        return $url;
    }

    $scheme = strtolower($parts['scheme'] ?? 'https');
    $host = strtolower($parts['host']);
    $path = rtrim($parts['path'] ?? '/', '/');

    return $scheme . '://' . $host .
        ($path !== '' ? $path : '/');
}

function addUniqueUrl(array &$urls, string $url): void {
    if (isFullUrl($url)) {
        $urls[canonicalUrl($url)] = $url;
    }
}

/* CONSULTA HTTP */

function fetchPage(string $url): array {
    validateSourceUrl($url);

    if (!function_exists('curl_init')) {
        throw new Exception('Extensão cURL não instalada.');
    }

    $ch = curl_init($url);

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 4,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => REQUEST_TIMEOUT,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_ENCODING => '',
        CURLOPT_USERAGENT =>
            'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36',
        CURLOPT_HTTPHEADER => [
            'Accept: text/html,application/xhtml+xml,application/json',
            'Accept-Language: pt-BR,pt;q=0.9,en;q=0.8'
        ]
    ]);

    $body = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $finalUrl = (string)curl_getinfo(
        $ch,
        CURLINFO_EFFECTIVE_URL
    );
    $error = curl_error($ch);

    if ($body === false) {
        throw new Exception('Falha na consulta: ' . $error);
    }

    if ($status >= 400) {
        throw new Exception('Erro HTTP ' . $status);
    }

    validateSourceUrl($finalUrl);

    if (!sameHost($url, $finalUrl)) {
        throw new Exception('Redirecionamento para outro domínio bloqueado.');
    }

    return [$body, $finalUrl];
}

/* TEXTO E METADADOS */

function cleanText(string $value): string {
    $value = html_entity_decode(
        strip_tags($value),
        ENT_QUOTES | ENT_HTML5,
        'UTF-8'
    );

    return trim(preg_replace('/\s+/u', ' ', $value) ?? '');
}

function metaValue(DOMXPath $xpath, string $query): string {
    $nodes = $xpath->query($query);

    if ($nodes && $nodes->length > 0) {
        return cleanText(
            $nodes->item(0)->getAttribute('content')
        );
    }

    return '';
}

function getSeasonNumber(string $text): ?int {
    if (preg_match(
        '/(?:season|temporada)[\s_-]*(\d+)/iu',
        $text,
        $match
    )) {
        return (int)$match[1];
    }

    return null;
}

/* IDENTIFICAÇÃO DAS PÁGINAS */

function isSeasonPageUrl(string $url): bool {
    $path = (string)parse_url($url, PHP_URL_PATH);

    return (bool)preg_match(
        '~/detail/drama/[^/]+/?$~i',
        $path
    );
}

function extractEpisodeNumber(string $url): ?int {
    $path = (string)parse_url($url, PHP_URL_PATH);

    if (preg_match(
        '~/detail/drama/[^/]+/(\d+)/?$~i',
        $path,
        $match
    )) {
        $number = (int)$match[1];

        return $number > 0 ? $number : null;
    }

    return null;
}

/* EXTRAI URLS DO JSON */

function collectJsonUrls(
    mixed $value,
    array &$urls,
    string $base,
    int $depth = 0
): void {
    if ($depth > 30) {
        return;
    }

    if (is_array($value)) {
        foreach ($value as $item) {
            collectJsonUrls(
                $item,
                $urls,
                $base,
                $depth + 1
            );
        }

        return;
    }

    if (!is_string($value)) {
        return;
    }

    if (preg_match_all(
        '~https?://[^\s"\'<>]+|/(?:pt/)?detail/(?:movie|drama)/[^"\s<>]+~i',
        $value,
        $matches
    )) {
        foreach ($matches[0] as $found) {
            $found = rtrim($found, '.,;)]}');

            $normalized = normalizeUrl($found, $base);

            if ($normalized) {
                addUniqueUrl($urls, $normalized);
            }
        }
    }
}

/* ANALISA UMA PÁGINA DE TEMPORADA */

function parseSeasonPage(string $html, string $url): array {
    libxml_use_internal_errors(true);

    $dom = new DOMDocument();

    $dom->loadHTML(
        '<?xml encoding="UTF-8">' . $html
    );

    $xpath = new DOMXPath($dom);

    $title = metaValue(
        $xpath,
        '//meta[@property="og:title"]'
    );

    if ($title === '') {
        $nodes = $xpath->query('//title');

        if ($nodes && $nodes->length > 0) {
            $title = cleanText(
                $nodes->item(0)->textContent
            );
        }
    }

    $description = metaValue(
        $xpath,
        '//meta[@property="og:description"]'
    );

    $poster = metaValue(
        $xpath,
        '//meta[@property="og:image"]'
    );

    if ($poster !== '') {
        $poster = normalizeUrl($poster, $url);
    }

    $allUrls = [];
    $seasonLinks = [];

    addUniqueUrl($allUrls, $url);

    /* Links HTML */

    $anchors = $xpath->query('//a[@href]');

    foreach ($anchors as $anchor) {
        $href = normalizeUrl(
            $anchor->getAttribute('href'),
            $url
        );

        if (!$href || !sameHost($href, $url)) {
            continue;
        }

        addUniqueUrl($allUrls, $href);

        $label = cleanText($anchor->textContent);

        if (
            isSeasonPageUrl($href) &&
            (
                getSeasonNumber($href) !== null ||
                getSeasonNumber($label) !== null
            )
        ) {
            addUniqueUrl($seasonLinks, $href);
        }
    }

    /* Scripts JSON */

    $scripts = $xpath->query('//script');

    foreach ($scripts as $script) {
        $content = trim($script->textContent);

        if ($content === '') {
            continue;
        }

        $json = json_decode($content, true);

        if (is_array($json)) {
            collectJsonUrls($json, $allUrls, $url);
        }
    }

    /* Next.js */

    $next = $xpath->query(
        '//script[@id="__NEXT_DATA__"]'
    );

    if ($next && $next->length > 0) {
        $json = json_decode(
            $next->item(0)->textContent,
            true
        );

        if (is_array($json)) {
            collectJsonUrls($json, $allUrls, $url);
        }
    }

    /* Descobre outras temporadas */

    foreach ($allUrls as $found) {
        if (
            sameHost($found, $url) &&
            isSeasonPageUrl($found) &&
            getSeasonNumber($found) !== null
        ) {
            addUniqueUrl($seasonLinks, $found);
        }
    }

    /* Extrai episódios sem duplicar */

    $episodes = [];

    foreach ($allUrls as $found) {
        if (!sameHost($found, $url)) {
            continue;
        }

        $number = extractEpisodeNumber($found);

        if ($number === null) {
            continue;
        }

        if (!isset($episodes[$number])) {
            $episodes[$number] = [
                'episode' => $number,
                'name' => 'Episódio ' . $number,
                'url' => $found,
                'id' => (string)$number
            ];
        }
    }

    ksort($episodes);

    return [
        'title' => $title,
        'description' => $description,
        'poster' => $poster,
        'season' => getSeasonNumber($title . ' ' . $url),
        'episodes' => array_values($episodes),
        'season_links' => array_values($seasonLinks),
        'discovered_pages' => count($allUrls)
    ];
}

/* BUSCA E ORGANIZA AS TEMPORADAS */

function extractSeries(string $sourceUrl): array {
    [$html, $finalUrl] = fetchPage($sourceUrl);

    $firstPage = parseSeasonPage($html, $finalUrl);

    $seriesTitle = $firstPage['title'];
    $description = $firstPage['description'];
    $poster = $firstPage['poster'];

    $queue = [$finalUrl];

    foreach ($firstPage['season_links'] as $link) {
        $queue[] = $link;
    }

    $visited = [];
    $seasons = [];
    $failedPages = [];
    $processed = 0;

    while (
        count($queue) > 0 &&
        $processed < MAX_SEASON_PAGES
    ) {
        $pageUrl = array_shift($queue);
        $key = canonicalUrl($pageUrl);

        if (isset($visited[$key])) {
            continue;
        }

        $visited[$key] = true;

        if (!sameHost($pageUrl, $finalUrl)) {
            continue;
        }

        try {
            if ($key === canonicalUrl($finalUrl)) {
                $pageData = $firstPage;
            } else {
                [$pageHtml, $resolvedUrl] = fetchPage($pageUrl);

                $pageData = parseSeasonPage(
                    $pageHtml,
                    $resolvedUrl
                );
            }

            $processed++;

            if ($seriesTitle === '' && $pageData['title'] !== '') {
                $seriesTitle = $pageData['title'];
            }

            if ($description === '' && $pageData['description'] !== '') {
                $description = $pageData['description'];
            }

            if ($poster === '' && $pageData['poster'] !== '') {
                $poster = $pageData['poster'];
            }

            $seasonNumber = $pageData['season'];

            if ($seasonNumber !== null && $seasonNumber > 0) {
                if (!isset($seasons[$seasonNumber])) {
                    $seasons[$seasonNumber] = [
                        'season' => $seasonNumber,
                        'name' => 'Temporada ' . $seasonNumber,
                        'episodes' => []
                    ];
                }

                foreach ($pageData['episodes'] as $episode) {
                    $episodeNumber = (int)$episode['episode'];

                    /*
                     * A chave combina temporada e número.
                     * Cada episódio aparece uma única vez
                     * dentro da temporada correspondente.
                     */
                    if (!isset(
                        $seasons[$seasonNumber]['episodes'][$episodeNumber]
                    )) {
                        $seasons[$seasonNumber]['episodes'][$episodeNumber] =
                            $episode;
                    }
                }
            }

            /* Adiciona novas páginas descobertas */

            foreach ($pageData['season_links'] as $newLink) {
                $newKey = canonicalUrl($newLink);

                $queuedKeys = array_map(
                    'canonicalUrl',
                    $queue
                );

                if (
                    !isset($visited[$newKey]) &&
                    !in_array($newKey, $queuedKeys, true)
                ) {
                    $queue[] = $newLink;
                }
            }

        } catch (Throwable $e) {
            $failedPages[] = [
                'url' => $pageUrl,
                'error' => $e->getMessage()
            ];

            continue;
        }
    }

    /* Ordena temporadas */

    ksort($seasons);

    $totalEpisodes = 0;

    foreach ($seasons as &$season) {
        ksort($season['episodes']);

        $season['episodes'] = array_values(
            $season['episodes']
        );

        $season['total_episodes'] = count(
            $season['episodes']
        );

        $totalEpisodes += $season['total_episodes'];
    }

    unset($season);

    /*
     * IMPORTANTE:
     * Não existe mais um campo "episodes" fora de "seasons".
     * Os episódios ficam exclusivamente dentro de cada temporada.
     */

    return [
        'title' => $seriesTitle,
        'description' => $description,
        'poster' => $poster,
        'type' => 'drama',
        'source_url' => $finalUrl,
        'current_season' => getSeasonNumber(
            $seriesTitle . ' ' . $finalUrl
        ),
        'total_seasons_found' => count($seasons),
        'total_episodes_found' => $totalEpisodes,
        'seasons' => array_values($seasons),
        'discovered_pages' => count($visited),
        'failed_pages' => $failedPages,
        'complete' => count($queue) === 0 &&
            count($failedPages) === 0,
        'warning' =>
            'Somente temporadas e episódios encontrados nos links e dados públicos foram incluídos.'
    ];
}

/* CONFIGURAÇÃO DA API */

$action = $_GET['action'] ?? 'detail';

if ($action === 'config') {
    output(true, [
        'name' => 'Seek Extractor API',
        'version' => '6.0',
        'actions' => ['config', 'detail'],
        'accepted_parameters' => [
            'url',
            'link',
            'param',
            'base',
            'type',
            'ep'
        ],
        'max_season_pages' => MAX_SEASON_PAGES,
        'platforms' => $allowedHosts
    ]);
}

if ($action !== 'detail') {
    output(false, null, 'Ação inválida.');
}

/* PARÂMETROS DO PAINEL */

$url = trim((string)($_GET['url'] ?? ''));
$link = trim((string)($_GET['link'] ?? ''));
$param = trim((string)($_GET['param'] ?? ''));
$base = trim((string)($_GET['base'] ?? ''));
$typeParam = trim((string)($_GET['type'] ?? ''));
$episodeParam = trim((string)($_GET['ep'] ?? '1'));

$sourceUrl = '';

foreach ([$url, $link, $param] as $candidate) {
    if (isFullUrl($candidate)) {
        $sourceUrl = $candidate;
        break;
    }
}

if ($sourceUrl === '' && isFullUrl($base)) {
    $relative = $param ?: ($link ?: $url);

    if ($relative !== '') {
        $sourceUrl = normalizeUrl($relative, $base);
    }
}

if ($sourceUrl === '') {
    output(
        false,
        null,
        'URL não encontrada. Informe uma URL completa em url, link ou param. Para caminhos relativos, informe base.'
    );
}

/* EXECUÇÃO */

try {
    validateSourceUrl($sourceUrl);

    $path = (string)parse_url(
        $sourceUrl,
        PHP_URL_PATH
    );

    if (preg_match('~/detail/drama/~i', $path)) {
        $data = extractSeries($sourceUrl);
    } else {
        [$html, $finalUrl] = fetchPage($sourceUrl);

        $page = parseSeasonPage($html, $finalUrl);

        $data = [
            'title' => $page['title'],
            'description' => $page['description'],
            'poster' => $page['poster'],
            'type' => 'movie',
            'source_url' => $finalUrl,
            'total_seasons_found' => 0,
            'total_episodes_found' => 0,
            'seasons' => [],
            'discovered_pages' => $page['discovered_pages']
        ];
    }

    if ($typeParam !== '') {
        $data['requested_type'] = $typeParam;
    }

    $data['requested_episode'] = max(
        1,
        (int)$episodeParam
    );

    output(true, $data);

} catch (Throwable $e) {
    output(false, null, $e->getMessage());
}
PHP

php -l api.php
