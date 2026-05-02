const config = require("./config");
const { logger } = require("./logger");

const notifyLogger = logger.child({ module: "notify" });

let transporter = null;
let warnedDisabled = false;
let warnedInvalid = false;

function normalizeRecipients(input) {
  if (Array.isArray(input)) {
    return input.map((item) => oneLine(item, 320)).filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(",")
      .map((item) => oneLine(item, 320))
      .filter(Boolean);
  }
  return [];
}

function oneLine(input, max = 120) {
  return String(input == null ? "" : input).replace(/\s+/g, " ").trim().slice(0, max);
}

function textBlock(input, max = 2000) {
  return String(input == null ? "" : input).slice(0, max);
}

function smtpAvailable(overrideTo) {
  if (!config.smtp.enabled) {
    if (!warnedDisabled) {
      warnedDisabled = true;
      notifyLogger.info("SMTP disabled. Set SMTP_ENABLED=true to enable email notifications");
    }
    return false;
  }

  const recipients = overrideTo && overrideTo.length ? overrideTo : config.smtp.to;
  const hasMinimalConfig = Boolean(config.smtp.host && config.smtp.from && recipients.length);
  if (!hasMinimalConfig) {
    if (!warnedInvalid) {
      warnedInvalid = true;
      notifyLogger.warn("SMTP enabled but missing SMTP_HOST / SMTP_FROM / SMTP_TO. Skip sending");
    }
    return false;
  }

  return true;
}

function getTransporter() {
  if (transporter) return transporter;
  const nodemailer = require("nodemailer");

  const options = {
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    requireTLS: config.smtp.requireTls
  };

  if (config.smtp.user || config.smtp.pass) {
    options.auth = {
      user: config.smtp.user,
      pass: config.smtp.pass
    };
  }

  transporter = nodemailer.createTransport(options);
  return transporter;
}

function subjectWithPrefix(subject) {
  const prefix = oneLine(config.smtp.subjectPrefix || "", 64);
  return prefix ? `${prefix} ${subject}` : subject;
}

async function sendTextMail(subject, lines, options = {}) {
  const recipients = normalizeRecipients(options.to);
  if (!smtpAvailable(recipients)) return false;
  const transport = getTransporter();
  const toList = recipients.length ? recipients : config.smtp.to;

  await transport.sendMail({
    from: config.smtp.from,
    to: toList.join(", "),
    subject: subjectWithPrefix(subject),
    text: lines.join("\n")
  });
  return true;
}

function formatCommonFooter() {
  return [
    "",
    `管理入口：${config.appBaseUrl.replace(/\/+$/, "")}/admin/`,
    `发送时间：${new Date().toISOString()}`
  ];
}

async function notifyNewFeedback(payload) {
  try {
    const sent = await sendTextMail(
      `新反馈 #${payload.id} ${oneLine(payload.title, 80)}`,
      [
        "收到新的反馈提交",
        `ID：${payload.id}`,
        `类型：${oneLine(payload.type, 40)}`,
        `标题：${oneLine(payload.title, 120)}`,
        `联系方式：${oneLine(payload.contact, 120) || "-"}`,
        "详细内容：",
        textBlock(payload.content, 2000),
        ...formatCommonFooter()
      ]
    );
    if (!sent) {
      return { sent: false, ok: false, reason: "smtp_not_ready" };
    }
    return { sent: true, ok: true };
  } catch (error) {
    return {
      sent: true,
      ok: false,
      error: error && error.message ? error.message : String(error)
    };
  }
}

async function notifyNewWorktask(payload) {
  try {
    const sourceLabel = payload.source === "admin" ? "本人添加" : "用户提交";
    const showOnHome = payload.showOnHome ? "是" : "否";
    const sent = await sendTextMail(
      `新任务 #${payload.id} ${oneLine(payload.title, 80)}`,
      [
        "收到新的任务提交",
        `ID：${payload.id}`,
        `来源：${sourceLabel}`,
        `类型：${oneLine(payload.type, 40)}`,
        `优先级：${oneLine(payload.priority, 20)}`,
        `状态：${oneLine(payload.status || "new", 20)}`,
        `主页展示：${showOnHome}`,
        `标题：${oneLine(payload.title, 120)}`,
        `联系方式：${oneLine(payload.contact, 120) || "-"}`,
        `负责人：${oneLine(payload.assignee, 80) || "-"}`,
        `标签：${oneLine(payload.tags, 120) || "-"}`,
        payload.expectedAt ? `期望时间：${payload.expectedAt}` : "期望时间：-",
        payload.scheduledAt ? `计划时间：${payload.scheduledAt}` : "计划时间：-",
        payload.publicReply ? `对外回复：${textBlock(payload.publicReply, 1000)}` : "对外回复：-",
        payload.adminNote ? `管理员备注：${textBlock(payload.adminNote, 1000)}` : "管理员备注：-",
        "详细内容：",
        textBlock(payload.content, 2500),
        ...formatCommonFooter()
      ]
    );
    if (!sent) {
      return { sent: false, ok: false, reason: "smtp_not_ready" };
    }
    return { sent: true, ok: true };
  } catch (error) {
    return {
      sent: true,
      ok: false,
      error: error && error.message ? error.message : String(error)
    };
  }
}

async function sendSmtpTestMail(payload = {}) {
  const to = normalizeRecipients(payload.to);
  const operator = oneLine(payload.operator || "admin", 80);
  const sent = await sendTextMail(
    "SMTP 测试邮件",
    [
      "这是一封来自 KyanetWorkStation 的 SMTP 测试邮件。",
      "若你收到此邮件，说明当前 SMTP 配置可正常发送。",
      `操作人：${operator}`,
      `SMTP 主机：${config.smtp.host || "-"}`,
      `SMTP 端口：${config.smtp.port}`,
      `SSL/TLS：${config.smtp.secure ? "SSL(secure=true)" : `STARTTLS(requireTLS=${config.smtp.requireTls})`}`,
      ...formatCommonFooter()
    ],
    { to }
  );
  return {
    sent: Boolean(sent),
    to: (to.length ? to : config.smtp.to).slice(0, 20)
  };
}

module.exports = {
  notifyNewFeedback,
  notifyNewWorktask,
  sendSmtpTestMail
};

