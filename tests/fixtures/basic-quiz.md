---
quiz: true
schemaVersion: 1
title: 计算机网络 · 第三章
tags:
  - quiz/net
---

# 计算机网络 · 第三章

## TCP 建立连接需要几次握手？

- 一次 ^a
- 两次 ^b
- 三次 ^c
- 四次 ^d

```quiz
id: tcp-handshake
type: single
answer: c
explanation: 三次握手用于同步双方的初始序列号。
stats: { attempts: 12, correct: 9, lastResult: correct, lastAt: 2025-01-01T10:00:00Z }
rev: stale-hash-for-test
history:
  - { at: 2025-01-01T10:00:00Z, result: correct, ms: 4200 }
  - { at: 2025-01-01T09:58:11Z, result: wrong, answer: b, ms: 6100 }
```

## 下列哪些属于传输层协议？

- TCP ^a
- UDP ^b
- IP ^c
- ICMP ^d

```quiz
type: multi
answer: [a, b]
shuffle: true
```

## 将协议与其默认端口配对

| 协议 | 端口 |
| --- | --- |
| HTTP | 80 |
| HTTPS | 443 |
| SSH | 22 |

```quiz
id: protocol-ports
type: match
```

## 将数据库与其类型配对

| 数据库 | 类型 |
| --- | --- |
| MySQL / PostgreSQL | 关系型 |
| Redis / Memcached | 键值型 |

```quiz
type: match
```

## 补全 TCP 首部字段

TCP 首部的最小长度是 ==20== ^b1 字节，其中 ==序号== ^b2 字段用于标识本报文段的数据的第一个字节。

```quiz
id: tcp-header
type: blank
blanks:
  b1: { accept: ["20", "20字节", "二十"] }
  b2: { ignoreCase: true }
```

## 简述 TCP 与 UDP 的主要区别。

从连接、可靠性、传输方式与适用场景四个方面作答。

> [!question]- 参考答案
> TCP 面向连接、可靠、字节流；UDP 无连接、不保证可靠、报文边界保留。

```quiz
id: tcp-vs-udp
type: essay
```

## 三元运算符的语法是什么？

这是普通正文，没有列表也没有表格。

```quiz
type: essay
```

## 缺少 type 字段的题

- 选项甲 ^a
- 选项乙 ^b

```quiz
answer: a
```

## 非法 type 取值的题

- 选项甲 ^a
- 选项乙 ^b

```quiz
type: multiple
answer: a
```

## 声明为多选题但题面没有列表

这里只有一段正文，没有任何列表。

```quiz
type: multi
answer: [a]
```

## 声明为配对题但题面没有表格

这里只有一段正文。

```quiz
type: match
```

## 声明为填空题但没有空位

这里没有高亮空位。

```quiz
type: blank
```

## 三个选项里有一个没有锚点

- 选项甲 ^a
- 选项乙
- 选项丙 ^c

```quiz
type: single
answer: a
```

## 答案指向不存在的锚点

- 选项甲 ^a
- 选项乙 ^b

```quiz
type: single
answer: z
```

## 数据块 YAML 有语法错误

- 选项甲 ^a
- 选项乙 ^b

```quiz
type: single
answer: [a
```
