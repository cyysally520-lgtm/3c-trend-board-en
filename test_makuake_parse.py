import re

test_cases = [
    '【MIL-STD-810H規格】過酷な環境に強い、無敵のタフモバイルバッテリー￥185,62049日185%NEW',
    'Keychron最新薄型キーボード 天然木デザイン×磁気スイッチ / 8KHz￥4,856,00049日971%NEW',
    '【純チタン99％×超軽量28g】圧倒的に明るく美しい。鍵より小さいLED懐中電灯￥2,878,00049日2878%',
]

for text in test_cases:
    print(f'Text: {text[:60]}...')
    
    # 新策略：找到最后一个逗号的位置，切分为前后两部分
    last_comma_idx = text.rfind(',')
    if last_comma_idx > 0:
        # 逗号后的部分：例如 "62049日185%NEW"
        after_comma = text[last_comma_idx+1:]
        # 匹配：连续数字 + 日
        m = re.match(r'(\d+)(\d{1,3})日', after_comma)
        if m:
            before_last = m.group(1)  # 6204
            days = int(m.group(2))     # 9
            # 逗号前的部分取数字
            before_comma_text = text[:last_comma_idx]
            before_match = re.search(r'￥([\d,]+)$', before_comma_text)
            if before_match:
                before_num = before_match.group(1).replace(',', '')
                amount = int(before_num + before_last)
                # 找达成率
                progress_match = re.search(r'(\d+)%', after_comma)
                progress = int(progress_match.group(1)) if progress_match else 0
                print(f'  Amount: {amount:,} 日元, Days: {days}, Progress: {progress}%')
    print()