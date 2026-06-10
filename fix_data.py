import json

fixes = {
    'cs-newae-chipwhisperer-husky': {'founder': 'NewAE Technology Inc.', 'location': 'Halifax, Nova Scotia, Canada'},
    'cs-leafkvm-leafkvm': {'founder': 'LeafKVM Team', 'location': 'Shenzhen, China'},
    'ks-comet-q': {'price': '¥69'}
}

for path in ['data/latest/crowdfunding.json', 'data/2026-06-10/crowdfunding.json']:
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    for item in data['items']:
        if item['id'] in fixes:
            item.update(fixes[item['id']])
            print(f'Fixed {item["id"]} in {path}')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')
print('Done')