//! git 출력 파서. 모두 순수 함수라 실제 git 없이 시험한다.

use std::collections::HashMap;

use super::model::*;

/// 필드 구분자 (Unit Separator)
pub const FS: char = '\x1f';
/// 레코드 구분자 (Record Separator)
pub const RS: char = '\x1e';

/// 커밋 한 줄 형식: sha, 부모, 작성자, 메일, 작성 시각, 참조(--decorate=full), 제목
pub const LOG_FORMAT: &str = "%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s";
/// 참조 없는 커밋 형식 (파일 이력·줄 이력)
pub const PLAIN_FORMAT: &str = "%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%x1f%s";

/// `HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1`
pub fn parse_decoration(d: &str) -> Vec<RefLabel> {
    let mut out = Vec::new();
    for part in d.split(", ").map(str::trim).filter(|p| !p.is_empty()) {
        if let Some(rest) = part.strip_prefix("HEAD -> ") {
            let name = rest.strip_prefix("refs/heads/").unwrap_or(rest).to_string();
            out.push(RefLabel { kind: RefKind::Head, name });
            if let Some(r) = classify(rest) {
                out.push(r);
            }
        } else if part == "HEAD" {
            out.push(RefLabel { kind: RefKind::Head, name: "HEAD".into() });
        } else if let Some(t) = part.strip_prefix("tag: ") {
            out.push(RefLabel { kind: RefKind::Tag, name: t.strip_prefix("refs/tags/").unwrap_or(t).into() });
        } else if let Some(r) = classify(part) {
            out.push(r);
        }
    }
    out
}

fn classify(full: &str) -> Option<RefLabel> {
    if let Some(n) = full.strip_prefix("refs/heads/") {
        return Some(RefLabel { kind: RefKind::Local, name: n.into() });
    }
    if let Some(n) = full.strip_prefix("refs/remotes/") {
        // origin/HEAD 같은 별칭은 뺀다
        return (!n.ends_with("/HEAD")).then(|| RefLabel { kind: RefKind::Remote, name: n.into() });
    }
    if let Some(n) = full.strip_prefix("refs/tags/") {
        return Some(RefLabel { kind: RefKind::Tag, name: n.into() });
    }
    if full.starts_with("refs/") {
        return None; // refs/stash, refs/notes 등
    }
    Some(RefLabel { kind: RefKind::Local, name: full.into() })
}

/// `LOG_FORMAT` / `PLAIN_FORMAT` 한 레코드
pub fn parse_commit(header: &str) -> Option<Commit> {
    let mut f = header.splitn(7, FS);
    let sha = f.next()?.trim().to_string();
    if sha.len() < 7 || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let parents = f.next()?.split_whitespace().map(String::from).collect();
    let author = f.next()?.to_string();
    let email = f.next()?.to_string();
    let time = f.next()?.trim().parse().unwrap_or(0);
    let refs = parse_decoration(f.next()?);
    let subject = f.next().unwrap_or("").trim_end_matches(['\r', '\n']).to_string();
    Some(Commit { sha, parents, author, email, time, subject, refs })
}

/// `git log -z --format=LOG_FORMAT` 출력
pub fn parse_log(out: &str) -> Vec<Commit> {
    out.split('\0').map(|r| r.trim_start_matches('\n')).filter(|r| !r.is_empty()).filter_map(parse_commit).collect()
}

/// `--raw --numstat -z` 출력 조각들을 바뀐 파일 목록으로.
/// raw 줄(`:100644 100644 a b M`, 경로)과 numstat 줄(`3\t1\t경로`, 이름 변경은 `3\t1\t` + 이전·새 경로)이 차례로 온다.
pub fn parse_raw_numstat(tokens: &[&str]) -> Vec<FileChange> {
    let mut raws: Vec<(String, String, Option<String>)> = Vec::new();
    let mut nums: Vec<(Option<u32>, Option<u32>, bool)> = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        let t = tokens[i].trim_start_matches('\n');
        if t.is_empty() {
            i += 1;
            continue;
        }
        if t.starts_with(':') {
            let code = t.rsplit(' ').next().unwrap_or("M");
            let letter = code.chars().next().unwrap_or('M').to_string();
            let p1 = tokens.get(i + 1).map(|s| s.to_string()).unwrap_or_default();
            if letter == "R" || letter == "C" {
                let p2 = tokens.get(i + 2).map(|s| s.to_string()).unwrap_or_default();
                raws.push((letter, p2, Some(p1)));
                i += 3;
            } else {
                raws.push((letter, p1, None));
                i += 2;
            }
        } else if let Some((a, rest)) = t.split_once('\t') {
            let (d, path) = rest.split_once('\t').unwrap_or((rest, ""));
            let binary = a == "-";
            nums.push((a.parse().ok(), d.parse().ok(), binary));
            // 이름 변경은 경로 자리가 비고 다음 두 조각이 이전·새 경로
            i += if path.is_empty() { 3 } else { 1 };
        } else {
            i += 1;
        }
    }
    raws.into_iter()
        .enumerate()
        .map(|(k, (status, path, old_path))| {
            let (additions, deletions, binary) = nums.get(k).cloned().unwrap_or((None, None, false));
            FileChange { status, path, old_path, additions, deletions, binary }
        })
        .collect()
}

/// `git status --porcelain=v2 -z --branch` 출력
pub fn parse_status(out: &str, limit: usize) -> Status {
    let mut s = Status::default();
    let tokens: Vec<&str> = out.split('\0').collect();
    let mut i = 0;
    let mut count = 0usize;
    while i < tokens.len() {
        let t = tokens[i];
        i += 1;
        if let Some(h) = t.strip_prefix("# ") {
            if let Some(v) = h.strip_prefix("branch.oid ") {
                s.head = (v != "(initial)").then(|| v.to_string());
            } else if let Some(v) = h.strip_prefix("branch.head ") {
                s.branch = (v != "(detached)").then(|| v.to_string());
            } else if let Some(v) = h.strip_prefix("branch.upstream ") {
                s.upstream = Some(v.to_string());
            } else if let Some(v) = h.strip_prefix("branch.ab ") {
                let mut it = v.split_whitespace();
                s.ahead = it.next().and_then(|a| a.trim_start_matches('+').parse().ok());
                s.behind = it.next().and_then(|b| b.trim_start_matches('-').parse().ok());
            }
            continue;
        }
        let kind = t.chars().next();
        let (xy, path, old_path) = match kind {
            Some('1') => {
                let f: Vec<&str> = t.splitn(9, ' ').collect();
                (f.get(1).copied().unwrap_or(".."), f.get(8).copied().unwrap_or(""), None)
            }
            Some('2') => {
                let f: Vec<&str> = t.splitn(10, ' ').collect();
                let orig = tokens.get(i).copied();
                i += 1;
                (f.get(1).copied().unwrap_or(".."), f.get(9).copied().unwrap_or(""), orig.map(String::from))
            }
            Some('u') => {
                let f: Vec<&str> = t.splitn(11, ' ').collect();
                let path = f.get(10).copied().unwrap_or("");
                if !path.is_empty() {
                    count += 1;
                    if count <= limit {
                        s.conflicted.push(WorkFile { path: path.into(), old_path: None, status: "U".into(), mtime: None });
                    }
                }
                continue;
            }
            Some('?') => {
                let path = t.get(2..).unwrap_or("");
                if !path.is_empty() {
                    count += 1;
                    if count <= limit {
                        s.unstaged.push(WorkFile { path: path.into(), old_path: None, status: "?".into(), mtime: None });
                    }
                }
                continue;
            }
            _ => continue,
        };
        if path.is_empty() {
            continue;
        }
        let mut chars = xy.chars();
        let (x, y) = (chars.next().unwrap_or('.'), chars.next().unwrap_or('.'));
        count += 1;
        if count > limit {
            continue;
        }
        if x != '.' {
            s.staged.push(WorkFile { path: path.into(), old_path: old_path.clone(), status: x.to_string(), mtime: None });
        }
        if y != '.' {
            // 스테이지 안 된 쪽의 이름 변경은 (intent-to-add가 아니면) 없으므로 이전 경로는 스테이지 쪽에만 둔다
            s.unstaged.push(WorkFile { path: path.into(), old_path: None, status: y.to_string(), mtime: None });
        }
    }
    s.truncated = count > limit;
    s
}

/// `upstream:track,nobracket` 값: `ahead 3, behind 2`, `gone`, 빈 값
pub fn parse_track(t: &str) -> (Option<u32>, Option<u32>, bool) {
    let t = t.trim();
    if t == "gone" {
        return (None, None, true);
    }
    let mut ahead = None;
    let mut behind = None;
    for part in t.split(',').map(str::trim) {
        if let Some(n) = part.strip_prefix("ahead ") {
            ahead = n.parse().ok();
        } else if let Some(n) = part.strip_prefix("behind ") {
            behind = n.parse().ok();
        }
    }
    (ahead, behind, false)
}

/// `git blame --porcelain` 출력
pub fn parse_blame(out: &str, encoding: &str) -> Blame {
    let mut commits: Vec<BlameCommit> = Vec::new();
    let mut lines = Vec::new();
    let mut cur: Option<usize> = None;
    let mut orig_line = 0u32;
    for line in out.split('\n') {
        if let Some(text) = line.strip_prefix('\t') {
            if let Some(c) = cur {
                lines.push(BlameLine { c, orig_line, text: text.trim_end_matches('\r').to_string() });
            }
            continue;
        }
        let mut parts = line.split(' ');
        let first = parts.next().unwrap_or("");
        if first.len() >= 40 && first.bytes().all(|b| b.is_ascii_hexdigit()) {
            let nums: Vec<u32> = parts.filter_map(|p| p.parse().ok()).collect();
            if nums.len() >= 2 {
                orig_line = nums[0];
                cur = Some(match commits.iter().position(|c| c.sha == first) {
                    Some(k) => k,
                    None => {
                        commits.push(BlameCommit {
                            sha: first.to_string(),
                            author: String::new(),
                            email: String::new(),
                            time: 0,
                            summary: String::new(),
                            path: String::new(),
                        });
                        commits.len() - 1
                    }
                });
                continue;
            }
        }
        let Some(c) = cur.and_then(|k| commits.get_mut(k)) else { continue };
        let (key, value) = line.split_once(' ').unwrap_or((line, ""));
        match key {
            "author" => c.author = value.to_string(),
            "author-mail" => c.email = value.trim_matches(['<', '>']).to_string(),
            "author-time" => c.time = value.parse().unwrap_or(0),
            "summary" => c.summary = value.to_string(),
            "filename" => c.path = value.to_string(),
            _ => {}
        }
    }
    Blame { commits, lines, encoding: encoding.to_string() }
}

/// reflog 파일 한 줄: `<이전> <새> 이름 <메일> 시각 시간대\t메시지`
pub struct ReflogLine {
    pub old: String,
    pub new: String,
    pub who: String,
    pub time: i64,
    pub message: String,
}

pub fn parse_reflog_line(line: &str) -> Option<ReflogLine> {
    let (left, message) = line.split_once('\t').unwrap_or((line, ""));
    let mut it = left.splitn(3, ' ');
    let old = it.next()?.to_string();
    let new = it.next()?.to_string();
    let rest = it.next()?;
    // 뒤에서부터: 시간대, 시각, 나머지(이름 <메일>)
    let mut back = rest.rsplitn(3, ' ');
    let _tz = back.next()?;
    let time = back.next()?.parse().ok()?;
    let who_full = back.next().unwrap_or("");
    let who = who_full.split(" <").next().unwrap_or(who_full).to_string();
    if old.len() < 40 || new.len() < 40 {
        return None;
    }
    Some(ReflogLine { old, new, who, time, message: message.trim_end_matches('\r').to_string() })
}

/// `git cat-file --batch` 출력에서 커밋별 제목을 꺼낸다
pub fn parse_cat_file_subjects(out: &[u8]) -> Vec<(String, String)> {
    let mut result = Vec::new();
    let mut pos = 0;
    while pos < out.len() {
        let Some(nl) = out[pos..].iter().position(|&b| b == b'\n') else { break };
        let header = String::from_utf8_lossy(&out[pos..pos + nl]).to_string();
        pos += nl + 1;
        let mut parts = header.split(' ');
        let sha = parts.next().unwrap_or("").to_string();
        let kind = parts.next().unwrap_or("");
        if kind == "missing" || kind.is_empty() {
            continue;
        }
        let size: usize = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        let end = (pos + size).min(out.len());
        let body = &out[pos..end];
        pos = end + 1; // 내용 뒤의 줄바꿈
        if kind != "commit" {
            continue;
        }
        let text = String::from_utf8_lossy(body);
        // 머리 뒤 빈 줄 다음이 메시지
        let subject = text.split_once("\n\n").map(|(_, m)| m.lines().next().unwrap_or("").to_string()).unwrap_or_default();
        result.push((sha, subject));
    }
    result
}

/// `git log -L ... --format=%x1e<PLAIN_FORMAT>` 출력: 커밋마다 머리 줄 + diff
pub fn parse_line_log(out: &str) -> Vec<LineHistoryEntry> {
    out.split(RS)
        .filter(|r| !r.trim().is_empty())
        .filter_map(|r| {
            let (header, diff) = r.split_once('\n').unwrap_or((r, ""));
            Some(LineHistoryEntry { commit: parse_commit(header)?, diff: diff.trim_start_matches('\n').to_string() })
        })
        .collect()
}

/// `git log --follow --format=%x1e<PLAIN_FORMAT> --raw --numstat -z` 출력
pub fn parse_file_history(out: &str, fallback_path: &str) -> Vec<HistoryEntry> {
    out.split(RS)
        .filter(|r| !r.trim_matches(['\0', '\n']).is_empty())
        .filter_map(|r| {
            let tokens: Vec<&str> = r.split('\0').collect();
            let commit = parse_commit(tokens.first()?.trim_end_matches('\n'))?;
            let files = parse_raw_numstat(tokens.get(1..).unwrap_or(&[]));
            // --follow면 이 파일 하나만 나온다. 병합 커밋처럼 비어 있으면 앞 커밋의 경로를 쓴다
            let f = files.into_iter().next();
            Some(HistoryEntry {
                commit,
                path: f.as_ref().map(|f| f.path.clone()).unwrap_or_else(|| fallback_path.to_string()),
                old_path: f.as_ref().and_then(|f| f.old_path.clone()),
                status: f.as_ref().map(|f| f.status.clone()).unwrap_or_default(),
                additions: f.as_ref().and_then(|f| f.additions),
                deletions: f.as_ref().and_then(|f| f.deletions),
            })
        })
        .collect()
}

/// `git log --format=%an%x1f%ae` 출력 → 작성자별 커밋 수 (이름이 같으면 한 사람, 메일은 가장 많이 쓴 것)
pub fn count_authors(out: &str) -> Vec<Author> {
    let mut by_name: HashMap<&str, (u32, HashMap<&str, u32>)> = HashMap::new();
    for line in out.lines() {
        let (name, email) = line.split_once(FS).unwrap_or((line, ""));
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        let e = by_name.entry(name).or_default();
        e.0 += 1;
        *e.1.entry(email.trim()).or_default() += 1;
    }
    let mut list: Vec<Author> = by_name
        .into_iter()
        .map(|(name, (count, emails))| {
            let email = emails.into_iter().max_by(|a, b| a.1.cmp(&b.1).then(b.0.cmp(a.0))).map(|(e, _)| e.to_string()).unwrap_or_default();
            Author { name: name.to_string(), email, count }
        })
        .collect();
    list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));
    list
}

/// 결과 줄에 보여 줄 글자 수 (긴 줄은 맞은 곳 앞뒤만)
const GREP_TEXT_CHARS: usize = 300;

/// `git grep -n --column -z` 출력: `경로\0줄\0칸\0내용\n`. 칸은 맞은 곳의 바이트 위치(1부터).
/// (결과, 맞은 파일 수, max에서 잘렸는지)
pub fn parse_grep(out: &[u8], max: usize) -> (Vec<GrepHit>, u32, bool) {
    let mut hits = Vec::new();
    let mut files = 0u32;
    let mut last: Option<&[u8]> = None;
    let mut truncated = false;
    for rec in out.split(|&b| b == b'\n') {
        let mut parts = rec.splitn(4, |&b| b == 0);
        let (Some(path), Some(line), Some(col), Some(text)) = (parts.next(), parts.next(), parts.next(), parts.next()) else { continue };
        let Ok(line) = std::str::from_utf8(line).unwrap_or("").parse::<u32>() else { continue };
        if last != Some(path) {
            files += 1;
            last = Some(path);
        }
        if hits.len() >= max {
            truncated = true;
            continue;
        }
        let col = std::str::from_utf8(col).ok().and_then(|c| c.parse::<usize>().ok()).unwrap_or(1).max(1);
        let text = text.strip_suffix(b"\r").unwrap_or(text);
        hits.push(GrepHit { path: super::decode(path).0, line, text: grep_window(text, col) });
    }
    (hits, files, truncated)
}

/// 줄 내용: 앞 들여쓰기를 빼고, 길면 맞은 곳(바이트 위치 col) 앞뒤만 남긴다
fn grep_window(text: &[u8], col: usize) -> String {
    let at = super::decode(&text[..(col - 1).min(text.len())]).0.chars().count();
    let chars: Vec<char> = super::decode(text).0.chars().collect();
    let indent = chars.iter().take_while(|c| c.is_whitespace()).count();
    let start = if at > indent + 120 { at - 60 } else { indent };
    let end = (start + GREP_TEXT_CHARS).min(chars.len());
    let mut s = String::new();
    if start > indent {
        s.push('…');
    }
    s.extend(&chars[start..end]);
    if end < chars.len() {
        s.push('…');
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grep_records() {
        let mut out = Vec::new();
        out.extend_from_slice(b"src/a.ts\x0012\x005\x00    const x = find()\r\n");
        out.extend_from_slice(b"src/a.ts\x0020\x001\x00find()\n");
        out.extend_from_slice("문서/메모.md\x003\x0010\x00한글 find 줄\n".as_bytes());
        let (hits, files, truncated) = parse_grep(&out, 10);
        assert_eq!(files, 2);
        assert!(!truncated);
        assert_eq!(hits[0], GrepHit { path: "src/a.ts".into(), line: 12, text: "const x = find()".into() });
        assert_eq!(hits[2].path, "문서/메모.md");
        assert_eq!(hits[2].text, "한글 find 줄");

        // 많으면 앞에서 자르고, 파일 수는 끝까지 센다
        let (hits, files, truncated) = parse_grep(&out, 1);
        assert_eq!((hits.len(), files, truncated), (1, 2, true));
    }

    #[test]
    fn grep_long_line_keeps_match() {
        let line = format!("{}needle{}", "a".repeat(500), "b".repeat(500));
        let out = format!("min.js\x001\x00501\x00{line}\n");
        let (hits, _, _) = parse_grep(out.as_bytes(), 10);
        let t = &hits[0].text;
        assert!(t.starts_with('…') && t.ends_with('…'), "{t}");
        assert!(t.contains("needle"));
        assert!(t.chars().count() <= 302);
    }

    #[test]
    fn authors_by_count() {
        let out = "김하늘\x1fsky@example.com\n이도윤\x1fdoyun@example.com\n김하늘\x1fsky@example.com\n김하늘\x1fold@example.com\n\x1fnobody@example.com\n";
        let list = count_authors(out);
        assert_eq!(list.len(), 2);
        assert_eq!((list[0].name.as_str(), list[0].email.as_str(), list[0].count), ("김하늘", "sky@example.com", 3));
        assert_eq!((list[1].name.as_str(), list[1].count), ("이도윤", 1));
    }

    #[test]
    fn decoration() {
        let refs = parse_decoration("HEAD -> refs/heads/main, refs/remotes/origin/main, refs/remotes/origin/HEAD, tag: refs/tags/v1.0, refs/stash");
        assert_eq!(
            refs,
            vec![
                RefLabel { kind: RefKind::Head, name: "main".into() },
                RefLabel { kind: RefKind::Local, name: "main".into() },
                RefLabel { kind: RefKind::Remote, name: "origin/main".into() },
                RefLabel { kind: RefKind::Tag, name: "v1.0".into() },
            ]
        );
        assert_eq!(parse_decoration("HEAD"), vec![RefLabel { kind: RefKind::Head, name: "HEAD".into() }]);
        assert!(parse_decoration("").is_empty());
    }

    #[test]
    fn log_records() {
        let out = "aaaaaaaa11\x1fbbbbbbbb22 cccccccc33\x1f홍길동\x1fhong@example.com\x1f1700000000\x1fHEAD -> refs/heads/main\x1f병합: feature\0\
                   bbbbbbbb22\x1f\x1fA\x1fa@example.com\x1f1690000000\x1f\x1f처음\x1fwith sep\0";
        let log = parse_log(out);
        assert_eq!(log.len(), 2);
        assert_eq!(log[0].parents, vec!["bbbbbbbb22", "cccccccc33"]);
        assert_eq!(log[0].subject, "병합: feature");
        assert_eq!(log[0].refs.len(), 2);
        assert!(log[1].parents.is_empty());
        assert_eq!(log[1].subject, "처음\x1fwith sep");
    }

    #[test]
    fn raw_numstat_with_rename_and_binary() {
        // git diff-tree -r -M --raw --numstat -z 실제 출력 모양
        let out = ":100644 100644 0ce6 9740 R081\0auth.ts\0login.ts\0:000000 100644 0000 de98 A\0sp ace 한글.txt\0:100644 100644 1111 2222 M\0img.png\0\
                   1\t0\t\0auth.ts\0login.ts\03\t0\tsp ace 한글.txt\0-\t-\timg.png\0";
        let tokens: Vec<&str> = out.split('\0').collect();
        let files = parse_raw_numstat(&tokens);
        assert_eq!(files.len(), 3);
        assert_eq!(files[0], FileChange { status: "R".into(), path: "login.ts".into(), old_path: Some("auth.ts".into()), additions: Some(1), deletions: Some(0), binary: false });
        assert_eq!(files[1].path, "sp ace 한글.txt");
        assert_eq!(files[1].additions, Some(3));
        assert!(files[2].binary);
        assert_eq!(files[2].additions, None);
    }

    #[test]
    fn status_v2() {
        let out = "# branch.oid 3379762eb374c3bd0ea7f440db383eff66235e8f\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0\
                   1 MM N... 100644 100644 100644 9740 d0b7 login.ts\0\
                   2 R. N... 100644 100644 100644 587b 587b R100 moved 파일.txt\0sp ace.txt\0\
                   u UU N... 100644 100644 100644 100644 a b c conflict.txt\0\
                   ? new 파일.txt\0";
        let s = parse_status(out, 100);
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!(s.upstream.as_deref(), Some("origin/main"));
        assert_eq!((s.ahead, s.behind), (Some(2), Some(1)));
        assert_eq!(s.staged.len(), 2);
        assert_eq!(s.staged[1], WorkFile { path: "moved 파일.txt".into(), old_path: Some("sp ace.txt".into()), status: "R".into(), mtime: None });
        assert_eq!(s.unstaged.iter().map(|f| (f.path.as_str(), f.status.as_str())).collect::<Vec<_>>(), vec![("login.ts", "M"), ("new 파일.txt", "?")]);
        assert_eq!(s.conflicted.len(), 1);
        assert!(!s.truncated);

        let s = parse_status("# branch.oid (initial)\0# branch.head (detached)\0? a\0? b\0? c\0", 2);
        assert_eq!((s.head, s.branch), (None, None));
        assert_eq!(s.unstaged.len(), 2);
        assert!(s.truncated);
    }

    #[test]
    fn track() {
        assert_eq!(parse_track("ahead 3, behind 2"), (Some(3), Some(2), false));
        assert_eq!(parse_track("behind 1"), (None, Some(1), false));
        assert_eq!(parse_track("gone"), (None, None, true));
        assert_eq!(parse_track(""), (None, None, false));
    }

    #[test]
    fn blame_porcelain() {
        let sha_a = "2867c31909b79f6e4140d2399a106ad9eca4e2dd";
        let sha_b = "4442300f753812e06011142f551873877a8854fd";
        let out = format!(
            "{sha_a} 1 1 1\nauthor 홍길동\nauthor-mail <hong@example.com>\nauthor-time 1795138682\nsummary 처음\nboundary\nfilename auth.ts\n\ta\r\n\
             {sha_b} 2 2 1\nauthor B\nauthor-mail <b@example.com>\nauthor-time 1795138690\nsummary 수정\nfilename auth.ts\n\tb2\n\
             {sha_a} 3 3\n\tc\n"
        );
        let b = parse_blame(&out, "utf-8");
        assert_eq!(b.commits.len(), 2);
        assert_eq!(b.commits[0].author, "홍길동");
        assert_eq!(b.commits[0].email, "hong@example.com");
        assert_eq!(b.commits[1].summary, "수정");
        assert_eq!(b.lines.len(), 3);
        assert_eq!((b.lines[0].c, b.lines[0].text.as_str()), (0, "a"));
        assert_eq!((b.lines[2].c, b.lines[2].orig_line), (0, 3));
    }

    #[test]
    fn reflog_line() {
        let l = parse_reflog_line(
            "4442300f753812e06011142f551873877a8854fd 3379762eb374c3bd0ea7f440db383eff66235e8f 홍 길동 <hong@example.com> 1795138683 +0900\tcommit (amend): 로그인 수정",
        )
        .unwrap();
        assert_eq!(l.who, "홍 길동");
        assert_eq!(l.time, 1795138683);
        assert_eq!(l.message, "commit (amend): 로그인 수정");
        assert!(parse_reflog_line("garbage").is_none());
    }

    #[test]
    fn cat_file_batch() {
        let body = "tree 4b82\nparent aaaa\nauthor A <a@e> 1 +0900\ncommitter A <a@e> 1 +0900\n\n제목 줄\n\n본문\n";
        let out = format!("1111 commit {}\n{}\n2222 missing\n", body.len(), body);
        assert_eq!(parse_cat_file_subjects(out.as_bytes()), vec![("1111".to_string(), "제목 줄".to_string())]);
    }

    #[test]
    fn file_history_records() {
        let out = "\x1e3379762eb374c3bd0ea7f440db383eff66235e8f\x1f4442300f753812e06011142f551873877a8854fd\x1ft\x1ft@e.com\x1f1795138683\x1f\x1frename\0\n\
                   :100644 100644 0ce6c09 9740c89 R081\0auth.ts\0login.ts\01\t0\t\0auth.ts\0login.ts\0\
                   \x1e4442300f753812e06011142f551873877a8854fd\x1f2867c31909b79f6e4140d2399a106ad9eca4e2dd\x1ft\x1ft@e.com\x1f1795138682\x1f\x1fedit auth\0\n\
                   :100644 100644 de98044 0ce6c09 M\0auth.ts\02\t1\tauth.ts\0";
        let h = parse_file_history(out, "login.ts");
        assert_eq!(h.len(), 2);
        assert_eq!((h[0].path.as_str(), h[0].old_path.as_deref(), h[0].status.as_str()), ("login.ts", Some("auth.ts"), "R"));
        assert_eq!((h[1].path.as_str(), h[1].additions, h[1].deletions), ("auth.ts", Some(2), Some(1)));
        assert_eq!(h[1].commit.subject, "edit auth");
    }

    #[test]
    fn line_log_records() {
        let out = "\x1e4442300f753812e06011142f551873877a8854fd\x1f2867c31909b79f6e4140d2399a106ad9eca4e2dd\x1ft\x1ft@e.com\x1f1795138682\x1f\x1fedit auth\n\ndiff --git a/auth.ts b/auth.ts\n@@ -1,2 +1,2 @@\n a\n-b\n+b2\n";
        let l = parse_line_log(out);
        assert_eq!(l.len(), 1);
        assert!(l[0].diff.starts_with("diff --git"));
    }
}
