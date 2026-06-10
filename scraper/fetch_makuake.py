import urllib.request, json, re, sys

url = 'https://www.makuake.com/discover/tags/8'
headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
req = urllib.request.Request(url, headers=headers)

print('Fetching Makuake page...')
with urllib.request.urlopen(req, timeout=30) as resp:
    html_content = resp.read().decode('utf-8')

print(f'HTML length: {len(html_content)}')

# 查找项目数据
matches = re.findall(r'window\.__INITIAL_STATE__\s*=\s*({.+?});', html_content, re.DOTALL)
if matches:
    print('Found __INITIAL_STATE__')
    data = json.loads(matches[0])
    # 查找项目列表
    def find_projects(d, depth=0):
        if depth > 5:
            return None
        if isinstance(d, dict):
            for k, v in d.items():
                if k in ('projects', 'items', 'list', 'data') and isinstance(v, list):
                    if v and isinstance(v[0], dict) and ('name' in v[0] or 'title' in v[0]):
                        return v
                result = find_projects(v, depth+1)
                if result:
                    return result
        elif isinstance(d, list):
            for item in d:
                result = find_projects(item, depth+1)
                if result:
                    return result
        return None
    
    projects = find_projects(data)
    if projects:
        print(f'Found {len(projects)} projects')
        for p in projects[:5]:
            print(json.dumps(p, ensure_ascii=False, indent=2)[:500])
            print('---')
    else:
        print('No projects found in __INITIAL_STATE__')
        print(json.dumps(data, ensure_ascii=False, indent=2)[:2000])
else:
    print('No __INITIAL_STATE__ found')
    # 保存HTML
    with open('scraper/test_makuake.html', 'w', encoding='utf-8') as f:
        f.write(html_content[:15000])
    print('Saved HTML to scraper/test_makuake.html')