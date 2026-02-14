function richTextToPlainText(richText) {
  if (!Array.isArray(richText)) {
    return '';
  }

  return richText.map((item) => item.plain_text || '').join('');
}

function readStatus(property) {
  if (!property) {
    return '';
  }

  if (property.type === 'status') {
    return property.status?.name || '';
  }

  if (property.type === 'select') {
    return property.select?.name || '';
  }

  if (property.type === 'formula' && property.formula?.type === 'string') {
    return property.formula.string || '';
  }

  return '';
}

function readSelect(property) {
  if (!property) {
    return '';
  }

  if (property.type === 'select') {
    return property.select?.name || '';
  }

  if (property.type === 'status') {
    return property.status?.name || '';
  }

  if (property.type === 'formula' && property.formula?.type === 'string') {
    return property.formula.string || '';
  }

  return '';
}

function readTitle(property) {
  if (!property) {
    return '';
  }

  if (property.type === 'title') {
    return richTextToPlainText(property.title);
  }

  if (property.type === 'rich_text') {
    return richTextToPlainText(property.rich_text);
  }

  return '';
}

function readMultiSelect(property) {
  if (!property) {
    return [];
  }

  if (property.type === 'multi_select') {
    return property.multi_select.map((option) => option.name).filter(Boolean);
  }

  if (property.type === 'people') {
    return property.people.map((person) => person.name || person.id).filter(Boolean);
  }

  return [];
}

function readRelationId(property) {
  if (!property) {
    return null;
  }

  if (property.type === 'relation') {
    return property.relation[0]?.id || null;
  }

  return null;
}

function readParentTaskId(page, props, config) {
  const parentItemProperty = props[config.notion.properties.parentItem];
  const parentFromProperty = readRelationId(parentItemProperty);
  if (parentFromProperty) {
    return parentFromProperty;
  }

  if (page.parent?.type === 'page_id' && page.parent.page_id) {
    return page.parent.page_id;
  }

  return null;
}

export function mapNotionPageToTask(page, config) {
  if (!page || page.object !== 'page') {
    return null;
  }

  const props = page.properties || {};

  const titleProperty = props[config.notion.properties.name];
  const statusProperty = props[config.notion.properties.status];
  const agentProperty = props[config.notion.properties.agent];
  const priorityProperty = props[config.notion.properties.priority];
  const typeProperty = props[config.notion.properties.type];

  return {
    id: page.id,
    name: readTitle(titleProperty) || '(Sem titulo)',
    status: readStatus(statusProperty),
    agents: readMultiSelect(agentProperty),
    priority: readSelect(priorityProperty),
    type: readSelect(typeProperty),
    parentId: readParentTaskId(page, props, config),
    url: page.url,
    createdTime: page.created_time,
    lastEditedTime: page.last_edited_time
  };
}

export function richTextToPlainTextForBlocks(richText) {
  return richTextToPlainText(richText);
}
