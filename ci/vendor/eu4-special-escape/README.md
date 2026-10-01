# EU4 Special Escape

Encoding functions from [unlangchan/EU4SpecialEscape-js](https://github.com/unlangchan/EU4SpecialEscape-js/blob/54f53bba40cc73372d24b76bd43b68ce7e130800/special-escape.js), pinned at `54f53bba40cc73372d24b76bd43b68ce7e130800`, under the included MIT license.

Adaptations: omit unused filesystem and decoding functions, export `encoding` as an ES module, declare its per-character binding locally, and update the reserved-byte table to match [EU4dll's encoder](https://github.com/matanki-saito/EU4dll/blob/5c74c5cec94df89c62d50b2e95e3faa98d7d80bc/Plugin64/escape_tool.cpp#L123). The older JavaScript table omitted `]` and other parser control bytes, causing EU4 to treat encoded Chinese characters as localisation syntax. This build dependency is excluded from player packages.
