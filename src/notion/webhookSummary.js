function firstNonEmpty(values) {
  for (const value of values) {
    if (value === null || value === undefined) {
      continue;
    }

    const text = String(value).trim();
    if (text.length > 0) {
      return text;
    }
  }

  return '';
}

function readStatusFromProperty(property, options = {}) {
  const allowSelect = Boolean(options.allowSelect);

  if (!property || typeof property !== 'object') {
    return '';
  }

  if (property.type === 'status') {
    return property.status?.name || '';
  }

  if (allowSelect && property.type === 'select') {
    return property.select?.name || '';
  }

  if (property.type === 'formula' && property.formula?.type === 'string') {
    return property.formula.string || '';
  }

  if (property.status?.name) {
    return property.status.name;
  }

  return '';
}

function readStatusFromProperties(properties, statusPropertyName) {
  if (!properties || typeof properties !== 'object') {
    return '';
  }

  const configuredProperty = statusPropertyName ? properties[statusPropertyName] : null;
  const configuredStatus = readStatusFromProperty(configuredProperty, { allowSelect: true });
  if (configuredStatus) {
    return configuredStatus;
  }

  for (const property of Object.values(properties)) {
    const status = readStatusFromProperty(property);
    if (status) {
      return status;
    }
  }

  return '';
}

function readStatus(payload, statusPropertyName) {
  const directStatus = firstNonEmpty([
    payload.status?.name,
    payload.data?.status?.name,
    payload.property_value?.status?.name,
    payload.data?.property_value?.status?.name,
    payload.data?.value?.status?.name
  ]);

  if (directStatus) {
    return directStatus;
  }

  const propertyContainers = [
    payload.properties,
    payload.data?.properties,
    payload.page?.properties,
    payload.data?.page?.properties,
    payload.entity?.properties,
    payload.data?.entity?.properties
  ];

  for (const properties of propertyContainers) {
    const status = readStatusFromProperties(properties, statusPropertyName);
    if (status) {
      return status;
    }
  }

  return '';
}

export function summarizeNotionWebhookEvent(body, statusPropertyName) {
  const payload = body || {};

  const eventType = firstNonEmpty([payload.type, payload.event?.type, payload.data?.type]) || 'unknown';
  const taskId =
    firstNonEmpty([
      payload.entity?.id,
      payload.entity?.page_id,
      payload.page?.id,
      payload.page_id,
      payload.data?.id,
      payload.data?.page_id,
      payload.data?.page?.id,
      payload.data?.entity?.id
    ]) || 'n/a';
  const status = readStatus(payload, statusPropertyName) || 'n/a';

  return {
    eventType,
    taskId,
    status
  };
}
