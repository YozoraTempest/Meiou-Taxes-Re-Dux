// MIT: see LICENSE in this directory.
// Upstream: unlangchan/EU4SpecialEscape-js @ 54f53bba40cc73372d24b76bd43b68ce7e130800
// Encoding functions only; adapted to ES modules and a local char binding.
// Reserved bytes match EU4dll @ 5c74c5cec94df89c62d50b2e95e3faa98d7d80bc.
// 编码映射1
function UCS2ToCP1252(cp) {
    var result = cp;
    switch (cp) {
        case 0x20AC: result = 0x80; break;
        case 0x201A: result = 0x82; break;
        case 0x0192: result = 0x83; break;
        case 0x201E: result = 0x84; break;
        case 0x2026: result = 0x85; break;
        case 0x2020: result = 0x86; break;
        case 0x2021: result = 0x87; break;
        case 0x02C6: result = 0x88; break;
        case 0x2030: result = 0x89; break;
        case 0x0160: result = 0x8A; break;
        case 0x2039: result = 0x8B; break;
        case 0x0152: result = 0x8C; break;
        case 0x017D: result = 0x8E; break;
        case 0x2018: result = 0x91; break;
        case 0x2019: result = 0x92; break;
        case 0x201C: result = 0x93; break;
        case 0x201D: result = 0x94; break;
        case 0x2022: result = 0x95; break;
        case 0x2013: result = 0x96; break;
        case 0x2014: result = 0x97; break;
        case 0x02DC: result = 0x98; break;
        case 0x2122: result = 0x99; break;
        case 0x0161: result = 0x9A; break;
        case 0x203A: result = 0x9B; break;
        case 0x0153: result = 0x9C; break;
        case 0x017E: result = 0x9E; break;
        case 0x0178: result = 0x9F; break;
    }

    return result;
}
// 编码映射2
function cp1252ToUCS2(cp) {
    var result = cp;
    switch (cp) {
        case 0x80: result = 0x20AC; break;
        case 0x82: result = 0x201A; break;
        case 0x83: result = 0x0192; break;
        case 0x84: result = 0x201E; break;
        case 0x85: result = 0x2026; break;
        case 0x86: result = 0x2020; break;
        case 0x87: result = 0x2021; break;
        case 0x88: result = 0x02C6; break;
        case 0x89: result = 0x2030; break;
        case 0x8A: result = 0x0160; break;
        case 0x8B: result = 0x2039; break;
        case 0x8C: result = 0x0152; break;
        case 0x8E: result = 0x017D; break;
        case 0x91: result = 0x2018; break;
        case 0x92: result = 0x2019; break;
        case 0x93: result = 0x201C; break;
        case 0x94: result = 0x201D; break;
        case 0x95: result = 0x2022; break;
        case 0x96: result = 0x2013; break;
        case 0x97: result = 0x2014; break;
        case 0x98: result = 0x02DC; break;
        case 0x99: result = 0x2122; break;
        case 0x9A: result = 0x0161; break;
        case 0x9B: result = 0x203A; break;
        case 0x9C: result = 0x0153; break;
        case 0x9E: result = 0x017E; break;
        case 0x9F: result = 0x0178; break;
    }

    return result;
}
function encoding(str) {
    let result = '';
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        var cp = char.codePointAt();
        if (UCS2ToCP1252(cp) != cp) {
            result += String.fromCharCode(cp);
            continue;
        }

        if (cp > 0x100 && cp < 0xA00) {
            cp = cp + 0xE000;
        }

        /* 上位字节 */
        var high = (cp >> 8) & 0x000000FF;

        /* 下位字节 */
        var low = cp & 0x000000FF;

        /* 识别码 */
        var escapeChr = 0x10;
        if (high == 0) {
            result += String.fromCharCode(low);
            continue;
        }

        /* 确定上位字节 */
        switch (high) {
            case 0xA4: case 0xA3: case 0xA7: case 0x24: case 0x5B: case 0x00: case 0x5C:
            case 0x20: case 0x0D: case 0x0A: case 0x22: case 0x7B: case 0x7D: case 0x40:
            case 0x80: case 0x7E: case 0x2F: case 0x5F: case 0xBD: case 0x3B: case 0x5D:
            case 0x3D: case 0x23: case 0x3F: case 0x3A: case 0x3C: case 0x3E: case 0x2A:
            case 0x7C:
                escapeChr += 2;
                break;
            default:
                break;
        }

        /* 确定下位字节 */
        switch (low) {
            case 0xA4: case 0xA3: case 0xA7: case 0x24: case 0x5B: case 0x00: case 0x5C:
            case 0x20: case 0x0D: case 0x0A: case 0x22: case 0x7B: case 0x7D: case 0x40:
            case 0x80: case 0x7E: case 0x2F: case 0x5F: case 0xBD: case 0x3B: case 0x5D:
            case 0x3D: case 0x23: case 0x3F: case 0x3A: case 0x3C: case 0x3E: case 0x2A:
            case 0x7C:
                escapeChr++;
                break;
            default:
                break;
        }
        /* 位码偏移 */
        switch (escapeChr) {
            case 0x11:
                low += 14;
                break;
            case 0x12:
                high -= 9;
                break;
            case 0x13:
                low += 14;
                high -= 9;
                break;
            case 0x10:
            default:
                break;
        }
        result += String.fromCharCode(escapeChr);
        result += String.fromCharCode(cp1252ToUCS2(low));
        result += String.fromCharCode(cp1252ToUCS2(high));
        continue;
    }
    return result;
}


export { encoding };
