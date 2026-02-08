/**
 * POI検索モジュール
 * チャットの自然言語からキーワードを抽出し、Overpass APIでOSM施設を検索
 * LLM/BERT不使用 - 辞書ベースのキーワードマッチング
 *
 * 検索の流れ:
 * 1. チャットメッセージからフィラー(えーと等)を除去
 * 2. キーワード辞書と正規表現マッチング
 * 3. ヒットしたキーワードのOSMタグでOverpass APIに問い合わせ
 * 4. GPS誤差円×5 の範囲内の該当施設を返却
 */
const POISearch = (() => {

  const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

  // ========== キーワード辞書 ==========
  // pattern: 口語・略称の正規表現
  // tags:    Overpass QL フィルタ（OSM公式タグ準拠）
  // label:   表示名
  //
  // OSMタグ参照:
  //   コンビニ → shop=convenience (※amenity=convenienceは存在しない)
  //   ファストフード → amenity=fast_food
  //   レストラン → amenity=restaurant
  //
  // 向河原駅500m圏内で動作確認済みの辞書
  const KEYWORDS = [
    // --- コンビニ (shop=convenience) ---
    { pattern: /セブン(?:イレブン)?/i, tags: '[shop=convenience]["name"~"セブン"]', label: 'セブンイレブン' },
    { pattern: /ローソン/i, tags: '["name"~"ローソン"][shop=convenience]', label: 'ローソン' },
    { pattern: /ファミ(?:マ|リーマート)/i, tags: '[shop=convenience]["name"~"ファミリーマート"]', label: 'ファミリーマート' },
    { pattern: /ミニストップ/i, tags: '[shop=convenience]["name"~"ミニストップ"]', label: 'ミニストップ' },
    { pattern: /デイリー(?:ヤマザキ)?/i, tags: '[shop=convenience]["name"~"デイリー"]', label: 'デイリーヤマザキ' },
    { pattern: /コンビニ/i, tags: '[shop=convenience]', label: 'コンビニ' },

    // --- ファストフード (amenity=fast_food) ---
    { pattern: /マック|マクド(?:ナルド)?/i, tags: '[amenity=fast_food]["name"~"マクドナルド|McDonald"]', label: 'マクドナルド' },
    { pattern: /すき家|すきや/i, tags: '[amenity~"fast_food|restaurant"]["name"~"すき家"]', label: 'すき家' },
    { pattern: /吉野家|よしのや/i, tags: '[amenity~"fast_food|restaurant"]["name"~"吉野家"]', label: '吉野家' },
    { pattern: /松屋(?!.{0,2}(?:銀座|呉服))/i, tags: '[amenity~"fast_food|restaurant"]["name"~"松屋"]', label: '松屋' },
    { pattern: /ケンタ(?:ッキー)?|KFC/i, tags: '[amenity=fast_food]["name"~"ケンタッキー|KFC"]', label: 'ケンタッキー' },
    { pattern: /モス(?:バーガー)?/i, tags: '[amenity=fast_food]["name"~"モスバーガー|MOS"]', label: 'モスバーガー' },
    { pattern: /ココイチ|CoCo壱/i, tags: '[amenity~"fast_food|restaurant"]["name"~"CoCo壱番屋|ココ壱"]', label: 'CoCo壱番屋' },

    // --- カフェ・レストラン ---
    { pattern: /スタバ|スターバックス/i, tags: '[amenity=cafe]["name"~"スターバックス|Starbucks"]', label: 'スターバックス' },
    { pattern: /ドトール/i, tags: '[amenity=cafe]["name"~"ドトール"]', label: 'ドトール' },
    { pattern: /ガスト/i, tags: '[amenity=restaurant]["name"~"ガスト"]', label: 'ガスト' },
    { pattern: /サイゼ(?:リヤ)?/i, tags: '[amenity=restaurant]["name"~"サイゼリヤ"]', label: 'サイゼリヤ' },
    { pattern: /ジョナサン/i, tags: '[amenity=restaurant]["name"~"ジョナサン"]', label: 'ジョナサン' },

    // --- スーパー (shop=supermarket) ---
    { pattern: /スーパー(?:マーケット)?/i, tags: '[shop=supermarket]', label: 'スーパー' },
    { pattern: /イオン/i, tags: '[shop~"supermarket|mall"]["name"~"イオン"]', label: 'イオン' },
    { pattern: /ライフ/i, tags: '[shop=supermarket]["name"~"ライフ"]', label: 'ライフ' },
    { pattern: /マルエツ/i, tags: '[shop=supermarket]["name"~"マルエツ"]', label: 'マルエツ' },
    { pattern: /東急ストア/i, tags: '[shop=supermarket]["name"~"東急ストア"]', label: '東急ストア' },

    // --- ドラッグストア (shop=chemist) + 薬局 (amenity=pharmacy) ---
    { pattern: /ドラッグ(?:ストア)?/i, tags: '[shop~"chemist|pharmacy"]', label: 'ドラッグストア' },
    { pattern: /薬局|やっきょく/i, tags: '[amenity=pharmacy]', label: '薬局' },
    { pattern: /マツキヨ|マツモトキヨシ/i, tags: '["name"~"マツモトキヨシ"]', label: 'マツモトキヨシ' },
    { pattern: /ウエルシア/i, tags: '["name"~"ウエルシア"]', label: 'ウエルシア' },
    { pattern: /ツルハ/i, tags: '["name"~"ツルハ"]', label: 'ツルハ' },

    // --- 公共施設 ---
    { pattern: /交番|こうばん/i, tags: '[amenity=police]', label: '交番' },
    { pattern: /消防署|しょうぼうしょ/i, tags: '[amenity=fire_station]', label: '消防署' },
    { pattern: /警察(?:署)?/i, tags: '[amenity=police]', label: '警察' },
    { pattern: /郵便局|ゆうびんきょく|ポスト/i, tags: '[amenity=post_office]', label: '郵便局' },
    { pattern: /市役所|区役所|町役場|村役場|役所|役場/i, tags: '[amenity=townhall]', label: '役所' },
    { pattern: /図書館|としょかん/i, tags: '[amenity=library]', label: '図書館' },

    // --- 医療 ---
    { pattern: /病院|びょういん/i, tags: '[amenity~"hospital|clinic"]', label: '病院' },
    { pattern: /クリニック/i, tags: '[amenity=clinic]', label: 'クリニック' },

    // --- 教育 ---
    { pattern: /小学校/i, tags: '[amenity=school]["name"~"小学校"]', label: '小学校' },
    { pattern: /中学校/i, tags: '[amenity=school]["name"~"中学校"]', label: '中学校' },
    { pattern: /高校|高等学校/i, tags: '[amenity=school]["name"~"高等学校|高校"]', label: '高校' },
    { pattern: /大学|だいがく/i, tags: '[amenity=university]', label: '大学' },
    { pattern: /学校|がっこう/i, tags: '[amenity~"school|university"]', label: '学校' },
    { pattern: /幼稚園|ようちえん/i, tags: '[amenity=kindergarten]', label: '幼稚園' },
    { pattern: /保育(?:園|所)|ほいくえん/i, tags: '[amenity~"kindergarten|childcare"]', label: '保育園' },

    // --- 宗教施設 ---
    { pattern: /神社|じんじゃ/i, tags: '[amenity=place_of_worship][religion=shinto]', label: '神社' },
    { pattern: /(?:お)?寺(?!子屋)|てら/i, tags: '[amenity=place_of_worship][religion=buddhist]', label: '寺' },
    { pattern: /教会|きょうかい/i, tags: '[amenity=place_of_worship][religion=christian]', label: '教会' },

    // --- レジャー ---
    { pattern: /公園|こうえん/i, tags: '[leisure=park]', label: '公園' },
    { pattern: /グラウンド|運動場/i, tags: '[leisure~"pitch|sports_centre"]', label: 'グラウンド' },

    // --- 交通 ---
    { pattern: /駅(?!前|ビル|構内)/i, tags: '[railway=station]', label: '駅' },
    { pattern: /バス停|バスてい/i, tags: '[highway=bus_stop]', label: 'バス停' },
    { pattern: /信号(?!無視)/i, tags: '[highway=traffic_signals]', label: '信号機' },
    { pattern: /踏切|ふみきり/i, tags: '[railway=level_crossing]', label: '踏切' },
    { pattern: /歩道橋|ほどうきょう/i, tags: '[highway=footway][bridge=yes]', label: '歩道橋' },
    { pattern: /ガソリンスタンド|ガソスタ|給油所/i, tags: '[amenity=fuel]', label: 'ガソリンスタンド' },
    { pattern: /駐車場|パーキング|コインパーキング/i, tags: '[amenity=parking]', label: '駐車場' },

    // --- 商業施設 ---
    { pattern: /銀行|ぎんこう/i, tags: '[amenity=bank]', label: '銀行' },
    { pattern: /ATM/i, tags: '[amenity=atm]', label: 'ATM' },
    { pattern: /ホテル/i, tags: '[tourism=hotel]', label: 'ホテル' },
    { pattern: /旅館|りょかん/i, tags: '[tourism=guest_house]', label: '旅館' },

    // --- 目印 ---
    { pattern: /橋(?!本)/i, tags: '[bridge=yes][highway]', label: '橋' },
    { pattern: /川(?!崎|口|越|上|下)/i, tags: '[waterway~"river|stream"]', label: '川' },
    { pattern: /鳥居/i, tags: '[man_made=torii]', label: '鳥居' },

    // --- 向河原駅周辺の固有名詞 ---
    { pattern: /NEC|エヌイーシー|日本電気/i, tags: '["name"~"NEC|日本電気"]', label: 'NEC' },
  ];

  // ========== テキストからキーワード抽出 ==========
  function extractKeywords(text) {
    // 口語フィラーを除去
    const cleaned = text
      .replace(/えーっと|あのー?|ええと|うーん|そのー?|なんか|あー+|えー+|うー+|っと/g, '')
      .replace(/[、。！？!?,.\s]+/g, ' ')
      .trim();

    const matches = [];
    for (const kw of KEYWORDS) {
      if (kw.pattern.test(cleaned) || kw.pattern.test(text)) {
        matches.push(kw);
      }
    }
    return matches;
  }

  // ========== Overpass API クエリ ==========
  // OSMデータベースに対して以下のクエリを実行:
  // 1. 指定座標を中心に、指定半径(m)の円内を検索
  // 2. node(点), way(線/面), relation(複合)の3種を検索
  // 3. タグフィルタで施設を絞り込み
  // 4. JSON形式で結果を取得
  async function searchNearby(lat, lng, radiusMeters, keyword) {
    const query = `
      [out:json][timeout:10];
      (
        node${keyword.tags}(around:${radiusMeters},${lat},${lng});
        way${keyword.tags}(around:${radiusMeters},${lat},${lng});
        relation${keyword.tags}(around:${radiusMeters},${lat},${lng});
      );
      out center body;
    `;

    const res = await fetch(OVERPASS_ENDPOINT, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!res.ok) throw new Error(`Overpass API error: ${res.status}`);

    const data = await res.json();
    return data.elements.map(el => ({
      id: el.id,
      name: el.tags?.name || keyword.label,
      lat: el.lat || el.center?.lat,
      lng: el.lon || el.center?.lon,
      tags: el.tags || {},
      type: keyword.label,
    })).filter(el => el.lat && el.lng);
  }

  // ========== メインの解析・検索関数 ==========
  async function analyzeMessage(text, callerLocation) {
    if (!callerLocation) return null;

    const keywords = extractKeywords(text);
    if (keywords.length === 0) return null;

    const radius = Math.max(callerLocation.accuracy * 5, 500); // 最低500m
    const results = [];

    const searches = keywords.map(async (kw) => {
      try {
        const pois = await searchNearby(
          callerLocation.lat,
          callerLocation.lng,
          radius,
          kw
        );
        return { keyword: kw, pois };
      } catch (e) {
        console.error(`POI検索エラー (${kw.label}):`, e);
        return { keyword: kw, pois: [] };
      }
    });

    const searchResults = await Promise.all(searches);

    for (const r of searchResults) {
      results.push(...r.pois.map(poi => ({
        ...poi,
        searchKeyword: r.keyword.label,
      })));
    }

    return {
      keywords: keywords.map(k => k.label),
      radius,
      results,
    };
  }

  return { extractKeywords, searchNearby, analyzeMessage };
})();
