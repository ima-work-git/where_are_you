/**
 * POI検索モジュール
 * チャットの自然言語からキーワードを抽出し、Overpass APIでOSM施設を検索
 * LLM/BERT不使用 - 辞書ベースのキーワードマッチング
 *
 * モード:
 *  単一キーワード → 誤差円×5 内の該当施設を全てマーク
 *  複数キーワード → 各カテゴリを検索 → 全カテゴリが近接する地点を絞り込み
 */
const POISearch = (() => {

  const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
  const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';

  // ========== キーワード辞書 ==========
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
    { pattern: /コメダ/i, tags: '[amenity=cafe]["name"~"コメダ"]', label: 'コメダ珈琲' },
    { pattern: /タリーズ/i, tags: '[amenity=cafe]["name"~"タリーズ|Tully"]', label: 'タリーズ' },
    { pattern: /カフェ|喫茶(?:店)?/i, tags: '[amenity=cafe]', label: 'カフェ' },
    { pattern: /ガスト/i, tags: '[amenity=restaurant]["name"~"ガスト"]', label: 'ガスト' },
    { pattern: /サイゼ(?:リヤ)?/i, tags: '[amenity=restaurant]["name"~"サイゼリヤ"]', label: 'サイゼリヤ' },
    { pattern: /ジョナサン/i, tags: '[amenity=restaurant]["name"~"ジョナサン"]', label: 'ジョナサン' },
    { pattern: /デニーズ/i, tags: '[amenity=restaurant]["name"~"デニーズ|Denny"]', label: 'デニーズ' },
    { pattern: /ファミレス|ファミリーレストラン/i, tags: '[amenity=restaurant][cuisine~"japanese|western|family"]', label: 'ファミレス' },
    { pattern: /レストラン|飲食店/i, tags: '[amenity=restaurant]', label: 'レストラン' },

    // --- 居酒屋・バー・飲み屋 ---
    { pattern: /居酒屋|いざかや/i, tags: '[amenity~"bar|pub|nightclub"]', label: '居酒屋' },
    { pattern: /バー|bar/i, tags: '[amenity~"bar|pub"]', label: 'バー' },
    { pattern: /鳥貴族/i, tags: '["name"~"鳥貴族"]', label: '鳥貴族' },
    { pattern: /和民|わたみ/i, tags: '["name"~"和民|わたみ"]', label: '和民' },
    { pattern: /魚民/i, tags: '["name"~"魚民"]', label: '魚民' },
    { pattern: /白木屋/i, tags: '["name"~"白木屋"]', label: '白木屋' },
    { pattern: /笑笑/i, tags: '["name"~"笑笑"]', label: '笑笑' },
    { pattern: /飲み屋|のみや/i, tags: '[amenity~"bar|pub|restaurant"]["name"~"居酒屋|酒場|酒処|のれん"]', label: '飲み屋' },

    // --- ラーメン・中華 ---
    { pattern: /ラーメン(?:屋)?|らーめん/i, tags: '[amenity~"restaurant|fast_food"]["name"~"ラーメン|らーめん|拉麺|らぁめん"]', label: 'ラーメン屋' },
    { pattern: /中華(?:料理)?(?:屋)?/i, tags: '[amenity=restaurant][cuisine=chinese]', label: '中華料理' },
    { pattern: /日高屋/i, tags: '["name"~"日高屋"]', label: '日高屋' },

    // --- 寿司・和食 ---
    { pattern: /寿司|すし|鮨/i, tags: '[amenity~"restaurant|fast_food"]["name"~"寿司|すし|鮨|スシ|寿し"]', label: '寿司屋' },
    { pattern: /くら寿司/i, tags: '["name"~"くら寿司"]', label: 'くら寿司' },
    { pattern: /スシロー/i, tags: '["name"~"スシロー"]', label: 'スシロー' },
    { pattern: /はま寿司/i, tags: '["name"~"はま寿司"]', label: 'はま寿司' },
    { pattern: /そば(?:屋)?|蕎麦/i, tags: '[amenity=restaurant]["name"~"そば|蕎麦|ソバ"]', label: 'そば屋' },
    { pattern: /うどん(?:屋)?/i, tags: '[amenity~"restaurant|fast_food"]["name"~"うどん|饂飩"]', label: 'うどん屋' },
    { pattern: /丸亀/i, tags: '["name"~"丸亀製麺"]', label: '丸亀製麺' },

    // --- 焼肉・カレー ---
    { pattern: /焼肉|やきにく/i, tags: '[amenity=restaurant]["name"~"焼肉|焼き肉|やきにく|カルビ"]', label: '焼肉屋' },
    { pattern: /カレー(?:屋)?/i, tags: '[amenity~"restaurant|fast_food"][cuisine=curry]', label: 'カレー屋' },

    // --- パン屋 (shop=bakery) ---
    { pattern: /パン屋|パンや|ベーカリー|bakery/i, tags: '[shop=bakery]', label: 'パン屋' },

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
    { pattern: /スギ薬局|スギ(?=薬)/i, tags: '["name"~"スギ薬局"]', label: 'スギ薬局' },

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
    { pattern: /歯医者|歯科|しか/i, tags: '[amenity~"dentist|clinic"]["name"~"歯科|デンタル"]', label: '歯科' },

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
    { pattern: /クリーニング/i, tags: '[shop=dry_cleaning]', label: 'クリーニング' },
    { pattern: /美容(?:院|室)|床屋|散髪|理容/i, tags: '[shop~"hairdresser|beauty"]', label: '美容院・理容室' },
    { pattern: /花屋|はなや/i, tags: '[shop=florist]', label: '花屋' },
    { pattern: /本屋|書店|ほんや/i, tags: '[shop=books]', label: '本屋' },
    { pattern: /100均|百均|ダイソー|セリア/i, tags: '[shop=variety_store]', label: '100円ショップ' },

    // --- 目印 ---
    { pattern: /橋(?!本)/i, tags: '[bridge=yes][highway]', label: '橋' },
    { pattern: /川(?!崎|口|越|上|下)/i, tags: '[waterway~"river|stream"]', label: '川' },
    { pattern: /鳥居/i, tags: '[man_made=torii]', label: '鳥居' },

    // --- 固有名詞 ---
    { pattern: /NEC|エヌイーシー|日本電気/i, tags: '["name"~"NEC|日本電気"]', label: 'NEC' },
  ];

  // ========== テキストからキーワード抽出 ==========
  const FILLER_RE = /えーっと|あのー?|ええと|うーん|そのー?|なんか|あー+|えー+|うー+|っと/g;

  // ========== かな正規化（ひらがな↔カタカナ汎用変換） ==========
  function toHiragana(str) {
    return str.replace(/[\u30A1-\u30F6]/g, ch =>
      String.fromCharCode(ch.charCodeAt(0) - 0x60)
    );
  }

  function toKatakana(str) {
    return str.replace(/[\u3041-\u3096]/g, ch =>
      String.fromCharCode(ch.charCodeAt(0) + 0x60)
    );
  }

  /** 元文字列 + ひらがな版 + カタカナ版（重複除去）*/
  function kanaVariants(str) {
    const set = new Set([str, toHiragana(str), toKatakana(str)]);
    return [...set];
  }

  function extractKeywords(text) {
    const cleaned = text
      .replace(FILLER_RE, '')
      .replace(/[、。！？!?,.\s]+/g, ' ')
      .trim();

    // かな正規化: カタカナ版・ひらがな版でもパターンマッチを試行
    const hiraClean = toHiragana(cleaned);
    const kataClean = toKatakana(cleaned);

    const matches = [];
    for (const kw of KEYWORDS) {
      if (kw.pattern.test(cleaned) || kw.pattern.test(text) ||
          kw.pattern.test(hiraClean) || kw.pattern.test(kataClean)) {
        matches.push(kw);
      }
    }
    return matches;
  }

  // ========== 形態素解析ベースの固有名詞抽出 ==========
  // TinySegmenter でテキストを分割 → ストップワード除去 → 隣接する非ストップ語を結合
  const segmenter = (typeof TinySegmenter !== 'undefined') ? new TinySegmenter() : null;

  // ストップワード（助詞・助動詞・動詞・形容詞・副詞・フィラー・位置語等）
  const STOP_WORDS = new Set([
    // 助詞
    'が', 'は', 'の', 'を', 'に', 'で', 'と', 'も', 'へ', 'や', 'か', 'な', 'ね', 'よ', 'わ', 'さ',
    'から', 'まで', 'より', 'って', 'けど', 'けれど', 'ので', 'のに', 'だから', 'だけど',
    'ば', 'たら', 'なら', 'だけ', 'しか', 'ばかり', 'ほど', 'くらい', 'ぐらい', 'など', 'とか',
    // 助動詞・語尾
    'です', 'ます', 'ました', 'ません', 'でした', 'た', 'だ', 'ない', 'なかった',
    'れる', 'られる', 'せる', 'させる', 'よう', 'そう', 'らしい', 'みたい',
    // 動詞（基本形・活用形）
    'ある', 'いる', 'する', 'なる', 'できる', 'くる', 'いく', 'おく', 'みる',
    'あり', 'い', 'し', 'なり', 'でき', 'き', 'いき',
    'あっ', 'いっ', 'しっ', 'なっ',
    '見える', '見え', '見えます', '見えた', 'みえる', 'みえ',
    '聞こえる', '聞こえ', 'きこえる',
    'あります', 'ありました', 'あった',
    'います', 'いました', 'いた',
    'します', 'しました', 'した',
    'ている', 'てる', 'でいる', 'てい', 'ちゃう',
    // 指示語
    'これ', 'それ', 'あれ', 'どれ',
    'この', 'その', 'あの', 'どの',
    'ここ', 'そこ', 'あそこ', 'どこ',
    'こう', 'そう', 'ああ', 'どう',
    'こちら', 'そちら', 'あちら', 'どちら',
    // 副詞・形容詞
    'とても', 'すごく', 'すごい', 'ちょっと', '少し', 'たぶん', 'たしか',
    'もう', 'まだ', 'けっこう', 'かなり', 'だいたい', 'ほとんど', 'あまり',
    '大きい', '大きな', '小さい', '小さな', '多い', '少ない', '新しい', '古い',
    // 位置・方向
    '前', '横', '隣', '向かい', '裏', '奥', '手前', 'そば', 'となり',
    '近く', 'あたり', '辺り', '向こう', '先', '右', '左', '上', '下', '中', '外',
    'まえ', 'よこ', 'うしろ', 'むこう', 'さき', 'みぎ', 'ひだり', 'うえ', 'した', 'なか', 'そと',
    // フィラー
    'えーと', 'えー', 'あの', 'あのー', 'えーっと', 'ええと', 'うーん', 'なんか', 'そのー',
    'あー', 'うー', 'えっと', 'まあ', 'んー', 'っと',
    // 接続詞
    'そして', 'それから', 'でも', 'しかし', 'だけど', 'ただ', 'また', 'あと',
    'それで', 'だから', 'なので',
    // その他
    'こと', 'もの', 'ところ', 'とこ', 'ほう', 'ため', 'つもり', 'はず',
    '今', 'いま', 'さっき', 'ここ', 'それ',
    // 句読点・記号
    '、', '。', '！', '？', '!', '?', ',', '.', '…', '・',
  ]);

  /**
   * TinySegmenter + ストップワードで固有名詞を抽出
   * 1. テキストを形態素分割
   * 2. ストップワードを除去
   * 3. 隣接する非ストップ語を結合（分割された固有名詞を復元）
   * 4. 辞書マッチ済みを除外
   */
  function extractProperNouns(text) {
    const cleaned = text.replace(FILLER_RE, '').trim();

    let segments;
    if (segmenter) {
      segments = segmenter.segment(cleaned);
    } else {
      // TinySegmenter未ロード時: 簡易分割（句読点・空白で分割）
      segments = cleaned.split(/[、。！？!?,.\s]+/).filter(Boolean);
    }

    // ストップワード判定して隣接する非ストップ語を結合
    const candidates = [];
    let current = '';

    for (const seg of segments) {
      const trimmed = seg.trim();
      if (!trimmed) continue;

      if (isStopWord(trimmed)) {
        // ストップワード → 溜まっていた非ストップ語を候補に追加
        if (current.length >= 2) {
          candidates.push(current);
        }
        current = '';
      } else {
        // 非ストップワード → 結合
        current += trimmed;
      }
    }
    // 末尾の残り
    if (current.length >= 2) {
      candidates.push(current);
    }

    // 辞書にマッチ済みのものは除外（かな正規化で漏れなく判定）
    return candidates.filter(c => {
      const variants = kanaVariants(c);
      for (const kw of KEYWORDS) {
        if (variants.some(v => kw.pattern.test(v))) return false;
      }
      return true;
    });
  }

  function isStopWord(word) {
    if (STOP_WORDS.has(word)) return true;
    // 1文字のひらがな・句読点はストップワード扱い
    if (word.length === 1 && /[ぁ-ん、。！？!?,.\s]/.test(word)) return true;
    return false;
  }

  // ========== 固有名詞で全タグ横断検索 ==========
  // [~"."~"keyword"] = 全タグのvalue を正規表現マッチ
  // name, brand, operator, alt_name, description, ref 等すべてが対象
  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 固有名詞検索: Overpass全タグ検索 + Nominatimジオコーディング 並行実行
   * Nominatimは読み仮名→漢字地名の変換を内部で処理するため、
   * "むさしこすぎ" → "武蔵小杉" のような検索が可能
   */
  async function searchByName(lat, lng, radiusMeters, name) {
    const [overpassPois, nominatimPois] = await Promise.all([
      searchByNameOverpass(lat, lng, radiusMeters, name),
      searchByNominatim(lat, lng, radiusMeters, name),
    ]);

    // 近接50m以内の重複を除去してマージ
    const merged = [...overpassPois];
    for (const np of nominatimPois) {
      const isDupe = merged.some(op =>
        distanceMeters(op.lat, op.lng, np.lat, np.lng) < 50
      );
      if (!isDupe) merged.push(np);
    }
    return merged;
  }

  /** Overpass 全タグ横断検索（かなバリアント付き） */
  async function searchByNameOverpass(lat, lng, radiusMeters, name) {
    const variants = kanaVariants(name);
    const regexPart = variants.map(v => escapeRegex(v)).join('|');
    const query = `
      [out:json][timeout:10];
      (
        node[~"."~"${regexPart}",i](around:${radiusMeters},${lat},${lng});
        way[~"."~"${regexPart}",i](around:${radiusMeters},${lat},${lng});
        relation[~"."~"${regexPart}",i](around:${radiusMeters},${lat},${lng});
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
    return data.elements.map(el => {
      const matchedTag = findMatchedTag(el.tags, name);
      return {
        id: el.id,
        name: el.tags?.name || el.tags?.brand || el.tags?.operator || name,
        lat: el.lat || el.center?.lat,
        lng: el.lon || el.center?.lon,
        tags: el.tags || {},
        type: matchedTag ? `${matchedTag.key}: ${name}` : `全タグ検索: ${name}`,
      };
    }).filter(el => el.lat && el.lng);
  }

  /**
   * Nominatim ジオコーディング検索
   * OSM内部の読み仮名辞書を利用して、ひらがな→漢字地名を解決
   * 例: "むさしこすぎ"→武蔵小杉, "しながわ"→品川
   */
  async function searchByNominatim(lat, lng, radiusMeters, name) {
    const deg = radiusMeters / 111000;
    const params = new URLSearchParams({
      q: name,
      format: 'json',
      limit: '5',
      viewbox: `${(lng - deg).toFixed(6)},${(lat + deg).toFixed(6)},${(lng + deg).toFixed(6)},${(lat - deg).toFixed(6)}`,
      bounded: '1',
      'accept-language': 'ja',
    });

    try {
      const res = await fetch(`${NOMINATIM_ENDPOINT}?${params}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.map(item => ({
        id: `nom_${item.place_id}`,
        name: item.display_name.split(',')[0].trim(),
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
        tags: { display_name: item.display_name, type: item.type, class: item.class },
        type: `地名検索: ${name}`,
      })).filter(el => el.lat && el.lng);
    } catch (e) {
      console.error(`Nominatim検索エラー (${name}):`, e);
      return [];
    }
  }

  /**
   * どのタグにキーワードがヒットしたか特定（かな正規化対応）
   */
  function findMatchedTag(tags, keyword) {
    if (!tags) return null;
    const variants = kanaVariants(keyword).map(v => v.toLowerCase());
    for (const [key, value] of Object.entries(tags)) {
      const valLower = value.toLowerCase();
      if (variants.some(v => valLower.includes(v))) {
        return { key, value };
      }
    }
    return null;
  }

  // ========== Overpass API クエリ ==========
  /**
   * 辞書マッチ検索: タグ検索 + ラベル名のname検索を1クエリで実行
   * 例: "寿司屋" → [amenity=restaurant][name~"寿司"] に加え、
   *     ["name"~"寿司屋|すしや|スシヤ"] でタグ不備のエントリも拾う
   */
  async function searchNearby(lat, lng, radiusMeters, keyword) {
    // label名のかなバリアントでname横断検索も追加
    const nameVariants = kanaVariants(keyword.label).map(v => escapeRegex(v));
    const nameRegex = nameVariants.join('|');

    const query = `
      [out:json][timeout:10];
      (
        node${keyword.tags}(around:${radiusMeters},${lat},${lng});
        way${keyword.tags}(around:${radiusMeters},${lat},${lng});
        relation${keyword.tags}(around:${radiusMeters},${lat},${lng});
        node["name"~"${nameRegex}",i](around:${radiusMeters},${lat},${lng});
        way["name"~"${nameRegex}",i](around:${radiusMeters},${lat},${lng});
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

  // ========== 2点間の距離(m) ==========
  function distanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ========== スコアリング ==========
  const TOP_N = 5;

  /**
   * 近距離ボーナス (0-100, ×40%)
   * 誤差円内=100, ×1-2=80, ×2-3=60, ×3-4=40, ×4-5=20, ×5超=0
   */
  function calcDistanceScore(dist, accuracy) {
    if (dist <= accuracy)     return 100;
    if (dist <= accuracy * 2) return 80;
    if (dist <= accuracy * 3) return 60;
    if (dist <= accuracy * 4) return 40;
    if (dist <= accuracy * 5) return 20;
    return 0;
  }

  /**
   * テキストマッチスコア (0-100, ×60%)
   *
   * ■ 辞書マッチ (searchKeyword が引用符なし):
   *   tag+name フィルタ済み → 高信頼ベース 85点
   *
   * ■ 固有名詞検索 (searchKeyword が "keyword" 形式):
   *   タグ重要度 × マッチ品質
   *
   *   タグ重要度:
   *     name=1.0, brand=0.85, operator=0.75, alt_name/short_name=0.7,
   *     name:*=0.65, その他=0.3
   *
   *   マッチ品質:
   *     完全一致=1.0        "めんぱち" == "めんぱち"
   *     前方一致=0.9        "めんぱち" found at start of "めんぱち 川崎店"
   *     含有=0.5+比率×0.3   "めんぱち" in "居酒屋めんぱち本店" → 比率=4/9≒0.44 → 0.63
   */
  const TAG_WEIGHTS = {
    name: 1.0, brand: 0.85, operator: 0.75,
    alt_name: 0.7, short_name: 0.7, official_name: 0.7, old_name: 0.7,
  };

  function calcTextScore(poi, searchKeyword) {
    // 辞書マッチ → ベース85点
    if (!searchKeyword.startsWith('"')) {
      return 85;
    }

    const keyword = searchKeyword.replace(/"/g, '');
    if (!poi.tags || !keyword) return 10;

    // かな正規化: キーワードの全バリアント(ひらがな/カタカナ)を生成
    const kwVariants = kanaVariants(keyword).map(v => v.toLowerCase());

    let best = 0;

    for (const [key, value] of Object.entries(poi.tags)) {
      const valLower = value.toLowerCase();
      // いずれかのかなバリアントがヒットするか判定
      const matched = kwVariants.find(kv => valLower.includes(kv));
      if (!matched) continue;

      // タグ重要度
      let w = TAG_WEIGHTS[key];
      if (w === undefined) {
        w = key.startsWith('name') ? 0.65 : 0.3;
      }

      // マッチ品質
      let q;
      if (valLower === matched) {
        q = 1.0;                         // 完全一致
      } else if (valLower.startsWith(matched)) {
        q = 0.9;                         // 前方一致
      } else {
        const ratio = keyword.length / value.length;
        q = 0.5 + ratio * 0.3;          // 含有 + 長さ比率
      }

      best = Math.max(best, w * q * 100);
    }

    return Math.round(best) || 10;
  }

  /**
   * 総合スコア = 距離×40% + テキスト×60%
   */
  function scorePOI(poi, callerLocation, searchKeyword) {
    const dist = distanceMeters(
      callerLocation.lat, callerLocation.lng, poi.lat, poi.lng
    );
    const dScore = calcDistanceScore(dist, callerLocation.accuracy);
    const tScore = calcTextScore(poi, searchKeyword);
    const total = Math.round(dScore * 0.4 + tScore * 0.6);
    return { totalScore: total, distanceScore: dScore, textScore: tScore, distance: Math.round(dist) };
  }

  // ========== 複数カテゴリの交差絞り込み ==========
  // 各カテゴリのPOI同士が proximityRadius 以内にあるペア/グループを抽出
  function findIntersections(searchResults, proximityRadius) {
    if (searchResults.length < 2) return null;

    // カテゴリごとにPOIを分類
    const categories = searchResults.map(r => ({
      label: r.keyword.label,
      pois: r.pois,
    })).filter(c => c.pois.length > 0);

    if (categories.length < 2) return null;

    // 基準: 最もPOI数が少ないカテゴリの各POIに対して、
    // 他の全カテゴリから proximityRadius 以内にPOIがあるか判定
    categories.sort((a, b) => a.pois.length - b.pois.length);
    const base = categories[0];
    const others = categories.slice(1);

    const clusters = [];

    for (const basePoi of base.pois) {
      // このbasePOIの近くに全カテゴリのPOIがあるか
      const nearbyFromEach = [];
      let allFound = true;

      for (const other of others) {
        const nearby = other.pois.filter(p =>
          distanceMeters(basePoi.lat, basePoi.lng, p.lat, p.lng) <= proximityRadius
        );
        if (nearby.length === 0) {
          allFound = false;
          break;
        }
        nearbyFromEach.push(...nearby);
      }

      if (allFound) {
        clusters.push({
          anchor: basePoi,
          nearby: nearbyFromEach,
          all: [basePoi, ...nearbyFromEach],
        });
      }
    }

    return clusters.length > 0 ? clusters : null;
  }

  // ========== メインの解析・検索関数 ==========
  async function analyzeMessage(text, callerLocation) {
    if (!callerLocation) return null;

    const keywords = extractKeywords(text);
    const radius = callerLocation.accuracy * 5;

    // 辞書マッチ + 固有名詞フォールバック
    const properNouns = extractProperNouns(text);

    // どちらもなければスキップ
    if (keywords.length === 0 && properNouns.length === 0) return null;

    const allLabels = [];

    // 辞書マッチの検索
    const dictSearches = keywords.map(async (kw) => {
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

    // 固有名詞の名前検索
    const nameSearches = properNouns.map(async (noun) => {
      try {
        const pois = await searchByName(
          callerLocation.lat,
          callerLocation.lng,
          radius,
          noun
        );
        const kw = { label: `"${noun}"`, tags: '' };
        return { keyword: kw, pois };
      } catch (e) {
        console.error(`名前検索エラー (${noun}):`, e);
        return { keyword: { label: `"${noun}"`, tags: '' }, pois: [] };
      }
    });

    const searchResults = await Promise.all([...dictSearches, ...nameSearches]);

    // 全結果をフラットにしてスコアリング
    const allResults = [];
    for (const r of searchResults) {
      for (const poi of r.pois) {
        const scores = scorePOI(poi, callerLocation, r.keyword.label);
        allResults.push({
          ...poi,
          searchKeyword: r.keyword.label,
          ...scores,
        });
      }
    }

    // ラベル収集
    for (const kw of keywords) allLabels.push(kw.label);
    for (const noun of properNouns) allLabels.push(`"${noun}"`);

    // 複数カテゴリの交差判定
    let intersections = null;
    const effectiveResults = searchResults.filter(r => r.pois.length > 0);
    if (effectiveResults.length >= 2) {
      intersections = findIntersections(effectiveResults, radius);
    }

    // スコア降順ソート → 上位N件
    allResults.sort((a, b) => b.totalScore - a.totalScore);
    const totalBeforeFilter = allResults.length;
    const topResults = allResults.slice(0, TOP_N);

    return {
      keywords: allLabels,
      radius,
      results: topResults,
      totalCount: totalBeforeFilter,
      intersections,
      isMultiKeyword: effectiveResults.length >= 2,
    };
  }

  return {
    extractKeywords, extractProperNouns, searchByName, searchNearby,
    analyzeMessage, distanceMeters, calcDistanceScore, calcTextScore, scorePOI,
    TOP_N,
  };
})();
