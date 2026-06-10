import re

with open('scraper/test_makuake.html', 'r', encoding='utf-8') as f:
    html = f.read()

# 查找项目链接
project_links = re.findall(r'href="(/project/[^"]+)"', html)
print(f'Found {len(project_links)} project links')
for link in project_links[:10]:
    print(link)

# 查找项目名称
project_names = re.findall(r'project[^>]*>([^<]{10,100})</', html)
print(f'\nFound {len(project_names)} project names')
for name in project_names[:5]:
    print(name.strip())

# 查找金额
amounts = re.findall(r'￥([\d,]+)', html)
print(f'\nFound {len(amounts)} amounts')
for a in amounts[:10]:
    print(a)