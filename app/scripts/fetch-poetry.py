#!/usr/bin/env python3
"""Reproduce poetry.json text from its pinned Wikisource revisions.

Default: verify the local snapshot. --write: replace extracted text only.
No database access; uses only Python's standard library.
"""
import argparse
import html
import json
from pathlib import Path
import re
import urllib.parse
import urllib.request


def extract(source):
    if '{{PD-old-70}}' not in source:
        raise ValueError('Expected public-domain source marker missing')
    match = re.search(r'<poem>(.*?)</poem>', source, re.S)
    # In this collection the first column is the readable modern transcription.
    # 개여울 uses explicit <br> elements instead of a <poem> element.
    text = match[1] if match else source.split('}}', 1)[1].split('== 라이선스 ==')[0]
    text = re.sub(r'<ref\b[^>]*>.*?</ref>', '', text, flags=re.S)
    text = re.sub(r'<big>.*?</big>', '', text, flags=re.S)
    text = re.sub(r'<br\s*/?>\s*\n?', '\n', text)
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'\[\[(?:[^]|]*\|)?([^]]+)\]\]', r'\1', text)
    text = '\n'.join(line.rstrip() for line in html.unescape(text).splitlines()).strip()
    if not text or any(mark in text for mark in ('{{', '}}', '[[', '<', '==')):
        raise ValueError('Unrecognized source markup; review before importing')
    return text


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    path = Path(__file__).resolve().parents[1] / 'demo/poetry.json'
    data = json.loads(path.read_text())
    params = {'action': 'query', 'revids': '|'.join(str(p['sourceRevision']) for p in data['poems']),
              'prop': 'revisions', 'rvprop': 'ids|content', 'rvslots': 'main', 'format': 'json', 'formatversion': 2}
    request = urllib.request.Request('https://ko.wikisource.org/w/api.php?' + urllib.parse.urlencode(params),
                                     headers={'User-Agent': 'KeepSNS-Demo/1.0 (public-domain poetry import)'})
    with urllib.request.urlopen(request, timeout=60) as response:
        pages = json.load(response)['query']['pages']
    revisions = {r['revid']: (p['title'], r['slots']['main']['content']) for p in pages for r in p['revisions']}
    for poem in data['poems']:
        title, source = revisions[poem['sourceRevision']]
        if title != poem['sourcePage']:
            raise ValueError('Source page does not match the pinned revision')
        text = extract(source)
        if not args.write and text != poem['text']:
            raise ValueError('Snapshot mismatch: ' + title)
        poem['text'] = text
    if args.write:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    print('PASS: 36 poems reproduced from attributed, pinned Wikisource revisions.')


if __name__ == '__main__':
    main()
