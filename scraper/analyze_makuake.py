import re

html = open('test_makuake.html', 'r', encoding='utf-8').read()

# Search for API URLs in scripts
api_patterns = [
    r'https?://[^\s"\']+api[^\s"\']*',
    r'https?://[^\s"\']+project[^\s"\']*',
    r'https?://[^\s"\']+discover[^\s"\']*',
]

for pattern in api_patterns:
    matches = re.findall(pattern, html)
    if matches:
        print(f'Pattern found {len(matches)} matches:')
        for m in list(set(matches))[:10]:
            print('  ', m)
        print()

# Search for JSON data
print('--- Looking for JSON data ---')
json_patterns = [
    r'window\.__[A-Z_]+__\s*=\s*({.+?});',
    r'"projects":\s*(\[.+?\])',
    r'"items":\s*(\[.+?\])',
]

for pattern in json_patterns:
    matches = re.findall(pattern, html, re.DOTALL)
    if matches:
        print(f'Found {len(matches)} matches for pattern')
        for m in matches[:2]:
            print(m[:200])
            print('---')

# Look for image URLs
print('--- Looking for image URLs ---')
img_patterns = [
    r'https?://[^\s"\']+\.jpg',
    r'https?://[^\s"\']+\.png',
    r'https?://[^\s"\']+\.jpeg',
    r'//[^\s"\']+\.jpg',
    r'//[^\s"\']+\.png',
]

all_imgs = []
for pattern in img_patterns:
    matches = re.findall(pattern, html)
    all_imgs.extend(matches)

print(f'Total images found: {len(all_imgs)}')
for img in list(set(all_imgs))[:20]:
    print('  ', img)