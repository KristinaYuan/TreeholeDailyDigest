(function () {
  const start = Date.parse(`${TreeholeDigestCore.dayKey()}T00:00:00+08:00`);
  const now = Date.now();
  const at = fraction => Math.floor((start + (now - start) * fraction) / 1000);
  const examples = [
    { pid: 9000001, text: '【虚构演示】今天在图书馆发现一个靠窗的位置。阳光刚好落在书页上，突然觉得，慢一点也很好。\n\n#校园生活', likenum: 128, reply: 32, timestamp: at(.2), label_info: { name: '校园生活' } },
    { pid: 9000002, text: '【虚构演示】想收集大家上过的、会在毕业后还记得的课。可以聊聊某一次课堂、某一句话，不一定只说课程名称。\n\n#课程心得', likenum: 96, reply: 87, timestamp: at(.35), label_info: { name: '课程心得' } },
    { pid: 9000003, text: '【虚构演示】整理了一份 AI 实习的时间表：先想清楚自己想尝试什么，再根据岗位要求准备项目和简历。欢迎补充。\n\n实习', likenum: 74, reply: 45, timestamp: at(.5), label_info: { name: '求职经历' } },
    { pid: 9000004, text: '【虚构演示】看到 9000001，也想起今早在湖边散步的那十分钟。没有特别的事情，但心情好了很多。\n\n校园生活 daily journal', likenum: 42, reply: 16, timestamp: at(.7) },
    { pid: 9000005, text: '【虚构演示】回复 #9000002：最喜欢一门会认真回答每个问题的选修课。#9000002 里大家的分享都很有意思。\n\n#课程心得', likenum: 31, reply: 9, timestamp: at(.8) },
    { pid: 9000006, text: '【虚构演示】给 #9000002 补充一个选课建议：留一点时间给自己好奇、但还不擅长的领域。\n\n#课程心得', likenum: 25, reply: 12, timestamp: at(.9) }
  ];
  globalThis.TreeholeDigestDemo = { fetchPage: async page => ({ code: 20000, data: { list: page === 1 ? examples : [], total: examples.length } }) };
})();
